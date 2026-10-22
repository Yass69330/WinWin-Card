-- Migration 069 : API des caisses, étape 4 — reverser les points d'avant
-- (contrat docs/api/03-contrat-api-v1.md §6 bis ; plan validé par le pilotage le 22/10)
--
-- POURQUOI. La caisse du commerçant cumule déjà des points sous le numéro de ses
-- clients. Quand un client installe sa carte WinWin, ces points y sont reversés
-- UNE SEULE FOIS (POST /api/v1/migrations). L'API reçoit des points déjà
-- convertis : aucun taux n'est codé ici.
--
-- OÙ. Dans le journal des AJUSTEMENTS (migration 052), pas dans celui des scans
-- (décision du pilotage, 22/10) : une migration est un ajustement de solde, pas un
-- passage. Aucune statistique, aucun segment, aucune relance ne lit ce journal :
-- la migration ne compte nulle part comme un passage, sans toucher une seule
-- fonction de statistiques. Correction : « Annuler le dernier mouvement » de la
-- fiche client (annuler_ajustement), ou un ajustement manuel.
--
-- CE QUE FAIT LA MIGRATION.
--   - ajustements.origine : 'dashboard' (tout l'existant) ou 'migration' ;
--   - ajustements.point_de_vente_id : la boutique où la migration est faite ;
--   - index unique : UNE migration par carte, même annulée (la correction passe
--     par un ajustement, jamais par une seconde migration) ;
--   - crediter_migration : une transaction, même verrou de la carte que le crédit
--     d'un scan ; renvoi du même nombre de points → « deja_migree », rien
--     recrédité ; autre nombre → refus ; carte au seuil → refus (à refaire après
--     la remise) ; en tampons, solde après migration au plus égal au seuil (au-delà,
--     l'excédent serait perdu à la remise suivante) ; 1 à 100 000 points ; met la
--     carte à jour (message, date) comme après un scan.
--
-- COÛT. Deux colonnes sur la table des ajustements (quelques lignes), un index,
-- une fonction. Ni clients ni scans ne sont touchés.
-- COMPATIBILITÉ. L'ancien code ignore colonnes et fonction ; un ajustement du
-- dashboard reçoit 'dashboard' par défaut. À exécuter AVANT le code. Rejouable.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.ajustements ADD COLUMN IF NOT EXISTS origine text NOT NULL DEFAULT 'dashboard';
ALTER TABLE public.ajustements ADD COLUMN IF NOT EXISTS point_de_vente_id uuid
  REFERENCES public.points_de_vente(id) ON DELETE SET NULL;
ALTER TABLE public.ajustements DROP CONSTRAINT IF EXISTS ajustements_origine_check;
ALTER TABLE public.ajustements ADD CONSTRAINT ajustements_origine_check
  CHECK (origine IN ('dashboard', 'migration'));
CREATE UNIQUE INDEX IF NOT EXISTS ajustements_migration_unique
  ON public.ajustements (client_id) WHERE origine = 'migration';

CREATE OR REPLACE FUNCTION public.crediter_migration(
  p_client_id         uuid,
  p_marchand_id       uuid,
  p_point_de_vente_id uuid,
  p_points            integer,
  p_max_value         integer,
  p_type_programme    text,
  p_msg_recompense    text,
  p_msg_progression   text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_serial text;
  v_avant  integer;
  v_apres  integer;
  v_deja   public.ajustements%ROWTYPE;
BEGIN
  IF p_points IS NULL OR p_points < 1 OR p_points > 100000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'points_hors_bornes');
  END IF;

  -- 1. Verrou de la carte (le même que crediter_scan) : sérialisé avec les
  --    scans, les ventes, les ajustements et une autre migration de ce client.
  SELECT pass_serial_number, stored_value INTO v_serial, v_avant
    FROM public.clients
   WHERE id = p_client_id AND marchand_id = p_marchand_id AND deleted_at IS NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'client_introuvable');
  END IF;

  -- 2. Une seule migration par carte. Lu APRÈS le verrou : un envoi simultané
  --    attend la fin du premier, puis voit sa ligne.
  SELECT * INTO v_deja FROM public.ajustements WHERE client_id = p_client_id AND origine = 'migration';
  IF FOUND THEN
    IF v_deja.stored_value_apres - v_deja.stored_value_avant = p_points THEN
      RETURN jsonb_build_object('ok', true, 'deja_migree', true,
        'stored_value_avant', v_deja.stored_value_avant, 'stored_value_apres', v_deja.stored_value_apres);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'migration_deja_faite');
  END IF;

  -- 3. Garde-fous : récompense en attente ; en tampons, pas au-delà du seuil.
  IF v_avant >= p_max_value THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'recompense_en_attente');
  END IF;
  v_apres := v_avant + p_points;
  IF p_type_programme IS DISTINCT FROM 'points' AND v_apres > p_max_value THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'points_hors_bornes');
  END IF;

  -- 4. Le solde et sa trace, hors des scans.
  UPDATE public.clients SET stored_value = v_apres WHERE id = p_client_id;
  INSERT INTO public.ajustements (client_id, marchand_id, stored_value_avant, stored_value_apres, origine, point_de_vente_id)
  VALUES (p_client_id, p_marchand_id, v_avant, v_apres, 'migration', p_point_de_vente_id);

  -- 5. La carte : message et date de mise à jour, comme après un scan.
  UPDATE public.passes
     SET notification_message = CASE WHEN v_apres >= p_max_value THEN p_msg_recompense
                                     ELSE replace(p_msg_progression, '{{solde}}', v_apres::text) END,
         updated_at = clock_timestamp()
   WHERE serial_number = v_serial AND marchand_id = p_marchand_id;

  RETURN jsonb_build_object('ok', true, 'deja_migree', false, 'stored_value_avant', v_avant, 'stored_value_apres', v_apres);
END;
$$;

REVOKE ALL ON FUNCTION public.crediter_migration(uuid, uuid, uuid, integer, integer, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crediter_migration(uuid, uuid, uuid, integer, integer, text, text, text)
  TO service_role;

COMMIT;

-- Contrôle après exécution (une ligne, attendu : t | t | t | 0) :
-- SELECT
--   (SELECT count(*) = 2 FROM information_schema.columns
--     WHERE table_name = 'ajustements' AND column_name IN ('origine', 'point_de_vente_id'))  AS colonnes_ok,
--   (SELECT count(*) = 1 FROM pg_indexes WHERE indexname = 'ajustements_migration_unique') AS index_ok,
--   (SELECT count(*) = 1 FROM pg_proc WHERE proname = 'crediter_migration')                AS fonction_ok,
--   (SELECT count(*) FROM ajustements WHERE origine <> 'dashboard')                        AS lignes_hors_dashboard;
