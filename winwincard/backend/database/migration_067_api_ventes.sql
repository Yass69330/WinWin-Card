-- Migration 067 : API des caisses, étape 2 — créditer une vente
-- (contrat docs/api/03-contrat-api-v1.md v1.0, §4 ; feu vert du pilotage le 21/10)
--
-- POURQUOI. POST /api/v1/ventes crédite la carte « par le même chemin que le
-- comptoir » : la transaction d'argent reste crediter_scan (migration 051), NON
-- MODIFIÉE. Cette migration ajoute seulement :
--   - points_de_vente.code_externe : le code du magasin dans la caisse du
--     commerçant (« DXB-014 »), unique par commerçant, réglé dans l'admin ;
--   - crediter_vente : appelle crediter_scan puis, DANS LA MÊME TRANSACTION, marque
--     la ligne de journal (canal « caisse », référence, montant en fils, date de
--     vente). Sur un renvoi de la même référence, vérifie que c'est bien la même
--     vente (même montant en fils) ; sinon refus, rien d'écrit.
--
-- COÛT. Une colonne vide sur une petite table, un index partiel, une fonction.
-- Ni clients ni scans ne sont réécrits.
-- COMPATIBILITÉ. L'ancien code ignore colonne et fonction. À exécuter AVANT le
-- code. Rejouable.
--
-- NUMÉRO. La migration « téléphone » (branche briques/f04-telephone, n° 067 sur
-- cette branche, jamais exécutée) prendra le n° suivant à son étape.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 1. Code caisse des boutiques ─────────────────────────────────────────────
ALTER TABLE public.points_de_vente ADD COLUMN IF NOT EXISTS code_externe text;
ALTER TABLE public.points_de_vente DROP CONSTRAINT IF EXISTS points_de_vente_code_externe_check;
ALTER TABLE public.points_de_vente ADD CONSTRAINT points_de_vente_code_externe_check
  CHECK (code_externe IS NULL OR code_externe ~ '^[A-Za-z0-9._:/-]{1,64}$');
CREATE UNIQUE INDEX IF NOT EXISTS points_de_vente_code_externe_unique
  ON public.points_de_vente (marchand_id, code_externe)
  WHERE code_externe IS NOT NULL AND deleted_at IS NULL;

-- ── 2. Créditer une vente ────────────────────────────────────────────────────
-- Mêmes paramètres que crediter_scan, plus la référence, le montant en fils et
-- la date de vente. Réponse : celle de crediter_scan ; refus « cle_autre_scan »
-- si la même référence revient avec un autre montant en fils (ou désigne une
-- ligne qui n'est pas une vente de caisse).
CREATE OR REPLACE FUNCTION public.crediter_vente(
  p_client_id         uuid,
  p_marchand_id       uuid,
  p_point_de_vente_id uuid,
  p_max_value         integer,
  p_montant           integer,
  p_type_programme    text,
  p_cle               uuid,
  p_msg_remise        text,
  p_msg_recompense    text,
  p_msg_progression   text,
  p_reference         text,
  p_montant_fils      integer,
  p_vendu_le          timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v        jsonb;
  v_ligne  record;
BEGIN
  v := public.crediter_scan(p_client_id, p_marchand_id, p_point_de_vente_id, p_max_value, p_montant,
                            p_type_programme, p_cle, p_msg_remise, p_msg_recompense, p_msg_progression);
  IF (v ->> 'ok')::boolean IS NOT TRUE THEN
    RETURN v;
  END IF;
  IF (v ->> 'deja_enregistre')::boolean THEN
    SELECT canal, montant_fils INTO v_ligne FROM public.scans WHERE id = (v ->> 'scan_id')::uuid;
    IF v_ligne.canal IS DISTINCT FROM 'caisse' OR v_ligne.montant_fils IS DISTINCT FROM p_montant_fils THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'cle_autre_scan');
    END IF;
    RETURN v;
  END IF;
  UPDATE public.scans
     SET canal = 'caisse', reference_externe = p_reference, montant_fils = p_montant_fils, vendu_le = p_vendu_le
   WHERE id = (v ->> 'scan_id')::uuid;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.crediter_vente(uuid, uuid, uuid, integer, integer, text, uuid, text, text, text, text, integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crediter_vente(uuid, uuid, uuid, integer, integer, text, uuid, text, text, text, text, integer, timestamptz)
  TO service_role;

COMMIT;

-- Contrôle après exécution (une ligne, attendu : t | t | t) :
-- SELECT
--   (SELECT count(*) = 1 FROM information_schema.columns
--     WHERE table_name = 'points_de_vente' AND column_name = 'code_externe')             AS colonne_ok,
--   (SELECT count(*) = 1 FROM pg_indexes WHERE indexname = 'points_de_vente_code_externe_unique') AS index_ok,
--   (SELECT count(*) = 1 FROM pg_proc WHERE proname = 'crediter_vente')                   AS fonction_ok;
