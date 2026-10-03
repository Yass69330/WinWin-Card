-- Migration 051 : le crédit incassable (étape 11a de la synthèse, audit 02 P1)
--
-- Aujourd'hui un scan fait TROIS écritures séparées : le solde
-- (increment_stored_value), puis, ensemble, la ligne de journal et la carte.
-- Une coupure entre elles laisse un solde crédité sans ligne ; deux scans du
-- même client peuvent écrire leurs lignes dans le désordre ; un renvoi crédite
-- deux fois (audit 02 §3.2, §4.1 à §4.3).
--
-- Quatre objets :
--   1. scans.cle_idempotence (uuid, nullable) + index unique (marchand_id, clé)
--      — une demande déjà enregistrée n'est jamais recréditée.
--   2. crediter_scan(...) — UNE transaction : verrou de la carte, renvoi
--      reconnu, crédit, ligne de journal, carte. Tout ou rien.
--   3. clients.stored_value >= 0 — un solde n'est jamais négatif.
--   4. marchands.max_value > 0  — un seuil n'est jamais nul ni négatif (un
--      seuil négatif ferait de chaque scan une remise de récompense).
--
-- Règles gravées :
--   • SIGNATURE UNIQUE ET DÉFINITIVE (passation §3.3) : crediter_scan(uuid, uuid,
--     uuid, integer, integer, text, uuid, text, text, text) RETURNS jsonb.
--     Jamais de variante de longueur différente.
--   • LA RÈGLE DU CRÉDIT RESTE DANS increment_stored_value, inchangée et appelée
--     telle quelle : un seul endroit décide du report, de la remise, du seuil.
--   • L'heure de la ligne est prise APRÈS le verrou (clock_timestamp(), pas
--     now() qui vaut le DÉBUT de la transaction) : l'ordre des dates suit
--     l'ordre des crédits, même quand deux scans du même client se chevauchent.
--   • Fermée à la clé publique dès sa création (anon, authenticated) ; seul le
--     serveur (service_role) l'exécute.
--
-- Additive : l'ancien code (increment_stored_value + écritures séparées) marche
-- tel quel avec cette base. À exécuter dans Supabase AVANT le push du code.
-- Rejouable. Verrous : quelques millisecondes sur clients, marchands et scans ;
-- lock_timeout de 5 s → si un verrou ne vient pas, la migration échoue sans rien
-- changer et se relance.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── 1. Clé d'idempotence ─────────────────────────────────────────────────────
-- Fournie par l'écran (étape 11b) ; NULL pour l'ancien écran (transition) et
-- pour tout l'historique. Unique PAR MARCHAND : un marchand ne peut ni lire ni
-- gêner les clés d'un autre.
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS cle_idempotence uuid;

CREATE UNIQUE INDEX IF NOT EXISTS scans_cle_idempotence_unique
  ON public.scans (marchand_id, cle_idempotence)
  WHERE cle_idempotence IS NOT NULL;

-- ── 2. Garde-fous ────────────────────────────────────────────────────────────
-- ADD CONSTRAINT n'a pas de IF NOT EXISTS : test sur pg_constraint. Vérifiées à
-- la pose : une ligne qui les viole fait échouer TOUTE la migration (rien posé).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'clients_stored_value_non_negatif'
                    AND conrelid = 'public.clients'::regclass) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_stored_value_non_negatif CHECK (stored_value >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'marchands_max_value_positif'
                    AND conrelid = 'public.marchands'::regclass) THEN
    ALTER TABLE public.marchands
      ADD CONSTRAINT marchands_max_value_positif CHECK (max_value > 0);
  END IF;
END $$;

-- ── 3. Le crédit en une transaction ──────────────────────────────────────────
-- Paramètres :
--   p_point_de_vente_id  boutique du scan (NULL : jeton marchand, mono-site)
--   p_max_value, p_montant, p_type_programme : exactement ceux que scan.js
--                        passait à increment_stored_value
--   p_cle                clé d'idempotence (NULL : ancien écran)
--   p_msg_*              messages de la carte, préparés par le serveur (les
--                        textes vivent dans i18n) pour les trois issues
--                        possibles ; « {{solde}} » y est remplacé par le solde
--                        après le scan.
-- Réponse :
--   {ok: true, deja_enregistre, scan_id, stored_value_avant, stored_value_apres, is_reset}
--   {ok: false, reason: 'client_introuvable' | 'cle_autre_scan' | 'scan_annule'}
-- Une clé prise au même instant par un AUTRE client lève 23505 à l'insertion :
-- la transaction entière est annulée (rien écrit), le serveur répond 409.
CREATE OR REPLACE FUNCTION public.crediter_scan(
  p_client_id         uuid,
  p_marchand_id       uuid,
  p_point_de_vente_id uuid,
  p_max_value         integer,
  p_montant           integer,
  p_type_programme    text,
  p_cle               uuid,
  p_msg_remise        text,
  p_msg_recompense    text,
  p_msg_progression   text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_points  boolean := (p_type_programme = 'points');
  v_serial  text;
  v_deja    public.scans%ROWTYPE;
  v_credit  record;
  v_scan_id uuid;
  v_message text;
BEGIN
  -- 1. Verrou de la carte, scopé au marchand. Tout ce qui suit est sérialisé
  --    avec les autres scans, annulations et parrainages de CE client.
  SELECT pass_serial_number INTO v_serial
    FROM public.clients
   WHERE id = p_client_id AND marchand_id = p_marchand_id AND deleted_at IS NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'client_introuvable');
  END IF;

  -- 2. Renvoi : clé déjà enregistrée → le premier résultat, rien d'écrit. Lu
  --    APRÈS le verrou : un second envoi simultané attend la fin du premier,
  --    puis voit sa ligne.
  IF p_cle IS NOT NULL THEN
    SELECT * INTO v_deja
      FROM public.scans
     WHERE marchand_id = p_marchand_id AND cle_idempotence = p_cle;
    IF FOUND THEN
      -- Même clé pour une autre carte, ou (en points) un autre montant : ce
      -- n'est pas un renvoi, c'est une erreur de l'écran. Refus, rien d'écrit.
      IF v_deja.client_id <> p_client_id
         OR (v_points AND v_deja.montant_credite IS DISTINCT FROM p_montant) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'cle_autre_scan');
      END IF;
      -- Scan annulé depuis (la caisse l'a vu dans l'historique) : jamais
      -- recrédité sous la même clé.
      IF v_deja.annule_le IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'scan_annule');
      END IF;
      RETURN jsonb_build_object(
        'ok', true, 'deja_enregistre', true, 'scan_id', v_deja.id,
        'stored_value_avant', v_deja.stored_value_avant,
        'stored_value_apres', v_deja.stored_value_apres,
        'is_reset', v_deja.recompense_distribuee);
    END IF;
  END IF;

  -- 3. Le crédit : la règle reste dans increment_stored_value (même verrou,
  --    déjà tenu par cette transaction).
  SELECT * INTO v_credit
    FROM public.increment_stored_value(p_client_id, p_max_value, p_montant, p_type_programme);

  -- 4. La ligne de journal. Colonnes de mesure (migration 031), mêmes règles
  --    qu'avant dans scan.js : montant_credite = 0 sur une remise en tampons,
  --    le montant sinon ; recompense_distribuee = c'est le scan de la remise.
  INSERT INTO public.scans (client_id, marchand_id, stored_value_avant, stored_value_apres,
                            montant_credite, recompense_distribuee, point_de_vente_id,
                            cle_idempotence, date_scan)
  VALUES (p_client_id, p_marchand_id, v_credit.stored_value_avant, v_credit.stored_value_apres,
          CASE WHEN v_credit.is_reset AND NOT v_points THEN 0 ELSE p_montant END,
          v_credit.is_reset, p_point_de_vente_id, p_cle, clock_timestamp())
  RETURNING id INTO v_scan_id;

  -- 5. La carte : message et date de mise à jour (la date décide si l'iPhone
  --    télécharge la nouvelle carte). Même choix de message qu'avant dans
  --    scan.js : remise en tampons → remise ; seuil franchi → récompense ;
  --    sinon (y compris la remise en points, qui reporte le surplus) → progression.
  v_message := CASE
    WHEN v_credit.is_reset AND NOT v_points THEN p_msg_remise
    WHEN NOT v_credit.is_reset AND v_credit.stored_value_apres >= p_max_value THEN p_msg_recompense
    ELSE replace(p_msg_progression, '{{solde}}', v_credit.stored_value_apres::text)
  END;
  UPDATE public.passes
     SET notification_message = v_message, updated_at = clock_timestamp()
   WHERE serial_number = v_serial AND marchand_id = p_marchand_id;

  RETURN jsonb_build_object(
    'ok', true, 'deja_enregistre', false, 'scan_id', v_scan_id,
    'stored_value_avant', v_credit.stored_value_avant,
    'stored_value_apres', v_credit.stored_value_apres,
    'is_reset', v_credit.is_reset);
END;
$$;

REVOKE ALL ON FUNCTION public.crediter_scan(uuid, uuid, uuid, integer, integer, text, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crediter_scan(uuid, uuid, uuid, integer, integer, text, uuid, text, text, text)
  TO service_role;

-- L'API de Supabase (PostgREST) doit connaître la nouvelle fonction.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── CONTRÔLE (à coller juste après) ──────────────────────────────────────────
-- Les sept colonnes doivent valoir true.
--
-- SELECT
--   EXISTS (SELECT 1 FROM information_schema.columns
--            WHERE table_schema = 'public' AND table_name = 'scans'
--              AND column_name = 'cle_idempotence' AND data_type = 'uuid')       AS colonne_ok,
--   EXISTS (SELECT 1 FROM pg_index i
--            WHERE i.indexrelid = to_regclass('public.scans_cle_idempotence_unique')
--              AND i.indisunique AND i.indisvalid)                                 AS index_ok,
--   (SELECT count(*) = 2 FROM pg_constraint
--     WHERE conname IN ('clients_stored_value_non_negatif', 'marchands_max_value_positif')
--       AND convalidated)                                                          AS gardes_fous_ok,
--   to_regprocedure('public.crediter_scan(uuid,uuid,uuid,integer,integer,text,uuid,text,text,text)')
--     IS NOT NULL                                                                   AS fonction_ok,
--   has_function_privilege('service_role',
--     'public.crediter_scan(uuid,uuid,uuid,integer,integer,text,uuid,text,text,text)', 'EXECUTE') AS serveur_ok,
--   NOT has_function_privilege('anon',
--     'public.crediter_scan(uuid,uuid,uuid,integer,integer,text,uuid,text,text,text)', 'EXECUTE')
--   AND NOT has_function_privilege('authenticated',
--     'public.crediter_scan(uuid,uuid,uuid,integer,integer,text,uuid,text,text,text)', 'EXECUTE') AS cle_publique_fermee,
--   has_function_privilege('service_role',
--     'public.increment_stored_value(uuid,integer,integer,text)', 'EXECUTE')       AS regle_appelable;

-- ── RETOUR ARRIÈRE ───────────────────────────────────────────────────────────
-- Inutile en cas normal : l'ancien code marche avec cette base. Remettre le code
-- en arrière d'abord (Railway → Rollback), puis seulement si nécessaire :
--
-- -- un garde-fou gêne (ex. l'admin doit enregistrer un seuil hors règle) :
-- ALTER TABLE public.clients   DROP CONSTRAINT IF EXISTS clients_stored_value_non_negatif;
-- ALTER TABLE public.marchands DROP CONSTRAINT IF EXISTS marchands_max_value_positif;
--
-- -- tout retirer (APRÈS le retour arrière du code, sinon chaque scan échoue) :
-- DROP FUNCTION IF EXISTS public.crediter_scan(uuid, uuid, uuid, integer, integer, text, uuid, text, text, text);
-- DROP INDEX IF EXISTS public.scans_cle_idempotence_unique;
-- ALTER TABLE public.scans DROP COLUMN IF EXISTS cle_idempotence;
