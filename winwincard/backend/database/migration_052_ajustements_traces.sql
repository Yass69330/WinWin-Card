-- Migration 052 : ajustements tracés, ajustement vérifié, annulation dans
-- l'ordre inverse (étape 13b de la synthèse, audit 02 P5 et §4.6)
--
-- Aujourd'hui l'ajustement du dashboard écrit une valeur absolue sans trace ni
-- contrôle : un scan passé pendant que la fiche est ouverte est effacé, et le
-- scan d'avant ne s'annule plus (« solde incohérent »), tout en restant compté
-- comme une visite.
--
-- Quatre objets :
--   1. Table `ajustements` — le journal des ajustements, À PART des scans : les
--      statistiques, les relances et l'admin comptent les scans comme des visites
--      (7 lecteurs) ; un ajustement n'en est pas une, aucun d'eux n'est touché.
--   2. ajuster_solde(...) — ajustement VÉRIFIÉ et tracé, en une transaction :
--      refusé si le solde a bougé depuis que l'écran l'a lu (« solde_change »).
--   3. annuler_ajustement(...) — annule un ajustement s'il est le dernier
--      mouvement actif du client (scan ou ajustement) et que le solde n'a pas
--      bougé depuis. Rend le solde d'avant.
--   4. annuler_scan(...) — même fonction, même signature (§3.3), plus une règle :
--      un ajustement actif plus récent que le scan → « pas_le_dernier ».
--
-- Ordre inverse : on annule toujours le DERNIER mouvement actif du client. Ex. :
-- scan 1→2, ajustement 2→9, scan 9→0 : annuler 9→0 (→ 9), puis l'ajustement
-- (→ 2), puis le scan (→ 1). Solde, journal et statistiques restent justes.
--
-- Règles gravées : signatures uniques et définitives ; fonctions fermées à la
-- clé publique (anon, authenticated) ; GRANT explicite à service_role sur la
-- table (leçon des migrations 028 et 030). Un ajustement d'AVANT cette
-- migration n'a pas de ligne : le scan qui le précède reste refusé par le
-- contrôle du solde (« solde_incoherent »), comme aujourd'hui.
--
-- Additive pour le code en place : l'ancien serveur n'appelle aucune de ces
-- fonctions et ne lit pas la table ; annuler_scan garde son comportement tant
-- qu'aucun ajustement n'est tracé. À exécuter dans Supabase AVANT le push du
-- code. Rejouable.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── 1. Le journal des ajustements ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ajustements (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid        NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  marchand_id        uuid        NOT NULL REFERENCES public.marchands (id) ON DELETE CASCADE,
  stored_value_avant integer     NOT NULL,
  stored_value_apres integer     NOT NULL,
  date_ajustement    timestamptz NOT NULL DEFAULT now(),
  annule_le          timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ajustements_client_date
  ON public.ajustements (client_id, date_ajustement DESC);

COMMENT ON TABLE public.ajustements IS
  'Ajustements de solde faits depuis le dashboard (étape 13b). Hors des scans : ce ne sont pas des visites.';

ALTER TABLE public.ajustements ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ajustements TO service_role;

-- ── 2. L'ajustement vérifié ──────────────────────────────────────────────────
-- p_attendu : le solde que l'écran affichait. NULL = pas de vérification (écran
-- d'avant l'étape 13b, TRANSITION). Réponse :
--   {ok: true, ajustement_id, stored_value}         ajusté et tracé
--   {ok: true, inchange: true, stored_value}        même valeur : rien d'écrit
--   {ok: false, reason: 'solde_change', stored_value}  un scan est passé entre-temps
--   {ok: false, reason: 'client_introuvable'}
CREATE OR REPLACE FUNCTION public.ajuster_solde(
  p_client_id   uuid,
  p_marchand_id uuid,
  p_attendu     integer,
  p_nouveau     integer
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_solde integer;
  v_id    uuid;
BEGIN
  -- Verrou de la carte : sérialisé avec les scans et les annulations du client.
  SELECT stored_value INTO v_solde
    FROM public.clients
   WHERE id = p_client_id AND marchand_id = p_marchand_id AND deleted_at IS NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'client_introuvable');
  END IF;

  IF p_attendu IS NOT NULL AND v_solde <> p_attendu THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'solde_change', 'stored_value', v_solde);
  END IF;

  IF p_nouveau = v_solde THEN
    RETURN jsonb_build_object('ok', true, 'inchange', true, 'stored_value', v_solde);
  END IF;

  UPDATE public.clients SET stored_value = p_nouveau WHERE id = p_client_id;
  INSERT INTO public.ajustements (client_id, marchand_id, stored_value_avant, stored_value_apres, date_ajustement)
  VALUES (p_client_id, p_marchand_id, v_solde, p_nouveau, clock_timestamp())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'ajustement_id', v_id, 'stored_value', p_nouveau);
END;
$$;

-- ── 3. Annuler un ajustement ─────────────────────────────────────────────────
-- Même discipline que annuler_scan (migration 038) : refus sans rien modifier si
-- introuvable, déjà annulé, pas le dernier mouvement actif du client, ou solde
-- différent de l'« après » de l'ajustement.
CREATE OR REPLACE FUNCTION public.annuler_ajustement(p_ajustement_id uuid, p_marchand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_aj     public.ajustements%ROWTYPE;
  v_solde  integer;
  v_serial text;
BEGIN
  SELECT * INTO v_aj FROM public.ajustements WHERE id = p_ajustement_id AND marchand_id = p_marchand_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'introuvable');
  END IF;
  IF v_aj.annule_le IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'deja_annule');
  END IF;

  SELECT stored_value, pass_serial_number INTO v_solde, v_serial
    FROM public.clients WHERE id = v_aj.client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'client_introuvable');
  END IF;

  -- Dernier mouvement actif du client : aucun scan ni ajustement actif après lui.
  IF EXISTS (SELECT 1 FROM public.scans
              WHERE client_id = v_aj.client_id AND annule_le IS NULL
                AND date_scan > v_aj.date_ajustement)
     OR EXISTS (SELECT 1 FROM public.ajustements
                 WHERE client_id = v_aj.client_id AND annule_le IS NULL AND id <> v_aj.id
                   AND date_ajustement > v_aj.date_ajustement) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pas_le_dernier');
  END IF;

  IF v_solde IS DISTINCT FROM v_aj.stored_value_apres THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'solde_incoherent');
  END IF;

  UPDATE public.clients     SET stored_value = v_aj.stored_value_avant WHERE id = v_aj.client_id;
  UPDATE public.ajustements SET annule_le = now() WHERE id = p_ajustement_id;

  RETURN jsonb_build_object(
    'ok', true,
    'client_id',    v_aj.client_id,
    'serial',       v_serial,
    'stored_value', v_aj.stored_value_avant
  );
END;
$$;

-- ── 4. annuler_scan : l'ordre inverse inclut les ajustements ─────────────────
-- Corps identique à la migration 038, plus le contrôle marqué « 13b ».
CREATE OR REPLACE FUNCTION public.annuler_scan(p_scan_id uuid, p_marchand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_scan         scans%ROWTYPE;
  v_solde_actuel integer;
  v_serial       text;
  v_plus_recent  uuid;
BEGIN
  -- Charger le scan cible, scopé au marchand.
  SELECT * INTO v_scan FROM scans WHERE id = p_scan_id AND marchand_id = p_marchand_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'introuvable');
  END IF;
  IF v_scan.annule_le IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'deja_annule');
  END IF;

  -- Verrou par carte : sérialise contre un scan concurrent sur le même client.
  SELECT stored_value, pass_serial_number INTO v_solde_actuel, v_serial
  FROM clients WHERE id = v_scan.client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'client_introuvable');
  END IF;

  -- Doit être le scan actif le plus récent de CE client.
  SELECT id INTO v_plus_recent
  FROM scans
  WHERE client_id = v_scan.client_id AND annule_le IS NULL
  ORDER BY date_scan DESC, id DESC
  LIMIT 1;
  IF v_plus_recent IS DISTINCT FROM p_scan_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pas_le_dernier');
  END IF;

  -- 13b : ni un ajustement actif plus récent (ordre inverse des mouvements).
  IF EXISTS (SELECT 1 FROM public.ajustements
              WHERE client_id = v_scan.client_id AND annule_le IS NULL
                AND date_ajustement > v_scan.date_scan) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pas_le_dernier');
  END IF;

  -- Intégrité : le solde courant doit correspondre à l'après du scan (sinon
  -- quelque chose a bougé entre-temps → on refuse plutôt que d'inverser à l'aveugle).
  IF v_solde_actuel IS DISTINCT FROM v_scan.stored_value_apres THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'solde_incoherent');
  END IF;

  -- Inversion : restaurer le solde d'avant, marquer le scan annulé.
  UPDATE clients SET stored_value = v_scan.stored_value_avant WHERE id = v_scan.client_id;
  UPDATE scans   SET annule_le = now() WHERE id = p_scan_id;

  RETURN jsonb_build_object(
    'ok', true,
    'client_id',    v_scan.client_id,
    'serial',       v_serial,
    'stored_value', v_scan.stored_value_avant
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ajuster_solde(uuid, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ajuster_solde(uuid, uuid, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.annuler_ajustement(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.annuler_ajustement(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── CONTRÔLE (à coller juste après) ──────────────────────────────────────────
-- Les six colonnes doivent valoir true.
--
-- SELECT
--   to_regclass('public.ajustements') IS NOT NULL                                AS table_ok,
--   has_table_privilege('service_role', 'public.ajustements', 'INSERT')
--     AND has_table_privilege('service_role', 'public.ajustements', 'UPDATE')
--     AND has_table_privilege('service_role', 'public.ajustements', 'SELECT')    AS droits_ok,
--   (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ajustements'::regclass) AS rls_ok,
--   has_function_privilege('service_role', 'public.ajuster_solde(uuid,uuid,integer,integer)', 'EXECUTE')
--     AND NOT has_function_privilege('anon', 'public.ajuster_solde(uuid,uuid,integer,integer)', 'EXECUTE') AS ajuster_ok,
--   has_function_privilege('service_role', 'public.annuler_ajustement(uuid,uuid)', 'EXECUTE')
--     AND NOT has_function_privilege('anon', 'public.annuler_ajustement(uuid,uuid)', 'EXECUTE')        AS annuler_ajustement_ok,
--   position('ajustements' IN pg_get_functiondef('public.annuler_scan(uuid,uuid)'::regprocedure)) > 0  AS annuler_scan_ok;

-- ── RETOUR ARRIÈRE ───────────────────────────────────────────────────────────
-- Inutile en cas normal : l'ancien code ne lit pas la table. Remettre le code en
-- arrière d'abord (Railway → Rollback), puis seulement si nécessaire : rejouer
-- la définition de annuler_scan de la migration 038, puis
-- DROP FUNCTION IF EXISTS public.annuler_ajustement(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.ajuster_solde(uuid, uuid, integer, integer);
-- La table `ajustements` peut rester (journal) ; DROP TABLE la ferait perdre.
