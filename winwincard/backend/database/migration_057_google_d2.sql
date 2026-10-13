-- Migration 057 : le message Google ne part plus vers les cartes iPhone (étape 23)
--
-- POURQUOI (décision D2 de Yass, 29/09). Le lien Google Wallet est créé pour CHAQUE
-- client à l'inscription, et l'objet Google avec lui : tous les messages Google
-- partaient donc aussi vers les clients iPhone, qui ne les voient jamais (Google
-- Wallet n'existe pas sur iPhone). 63 % des messages Google acceptés le 26/09.
-- Diagnostic : PASSATION §15 duoquadragies.
--
-- RÈGLE (piste b, validée le 13/10) : un client est servi côté Google s'il a
-- OUVERT le lien Google (passes.google_ouvert_le, posé par GET
-- /api/passes/:serial/google ou par la vérification unique), OU s'il n'a aucune
-- carte Apple installée (aucune ligne device_tokens). Un client qui a les deux
-- cartes reçoit les deux.
--
-- CE QUE FAIT LA MIGRATION.
--   - colonne `passes.google_ouvert_le` (nullable, aucune valeur posée ici) ;
--   - `reserver_relances` (cron) : même signature, même règle, seul le drapeau
--     `google` des élus suit la règle D2 ;
--   - `cartes_google_campagne(marchand, après, limite)` : la voie Google des
--     campagnes, par id croissant (curseur), selon la règle D2 ;
--   - `cartes_google_a_verifier(après, limite)` : pour la vérification unique,
--     les cartes qui ont un jeton Apple, un lien Google, et pas encore le signal.
--
-- COÛT. Aucune requête régulière en plus. Les sondes device_tokens passent par
-- idx_device_tokens_serial.
--
-- À exécuter dans Supabase AVANT de déployer le code de l'étape 23. L'ancien code
-- reste compatible (il ignore la colonne ; le cron profite déjà de la règle). Rejouable.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.passes ADD COLUMN IF NOT EXISTS google_ouvert_le timestamptz;

COMMENT ON COLUMN public.passes.google_ouvert_le IS
  'Le client a ouvert le lien Google Wallet (ou la vérification unique a trouvé une carte Google enregistrée). Règle D2 : message Google si posé, ou si aucune carte Apple.';

-- ── reserver_relances (même signature qu'en 055) ────────────────────────────
CREATE OR REPLACE FUNCTION public.reserver_relances(
  p_marchand_id uuid, p_type text, p_lot uuid, p_modeles jsonb, p_limite integer,
  p_jours integer DEFAULT NULL, p_min integer DEFAULT NULL, p_max integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_maintenant timestamptz := now();
  v_jour       timestamptz := date_trunc('day',  now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_annee      timestamptz := date_trunc('year', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_mmjj       text        := to_char(now() AT TIME ZONE 'UTC', 'MM-DD');
  v_resultat   jsonb;
BEGIN
  IF p_type IS NULL OR p_type NOT IN ('inactive', 'near_reward', 'birthday') THEN
    RAISE EXCEPTION 'reserver_relances : type inconnu (%)', p_type;
  END IF;
  IF p_limite IS NULL OR p_limite < 1 OR p_limite > 1000 THEN
    RAISE EXCEPTION 'reserver_relances : limite hors de [1, 1000] (%)', p_limite;
  END IF;
  IF p_type = 'inactive' AND (p_jours IS NULL OR p_jours < 1) THEN
    RAISE EXCEPTION 'reserver_relances : délai d''inactivité absent';
  END IF;
  IF p_type = 'near_reward' AND (p_min IS NULL OR p_max IS NULL) THEN
    RAISE EXCEPTION 'reserver_relances : zone near_reward absente';
  END IF;

  -- Un seul appel à la fois par marchand, tous types confondus (règle « une par
  -- jour » entre types). L'instruction suivante prend son instantané APRÈS le
  -- verrou : elle voit les réservations de l'appel précédent.
  PERFORM pg_advisory_xact_lock(hashtextextended('relances:' || p_marchand_id::text, 0));

  WITH base AS MATERIALIZED (
    SELECT c.id, c.prenom, c.pass_serial_number AS serial, c.stored_value, c.updated_at,
           -- Règle D2 (étape 23, migration 057) : message Google seulement si le
           -- client a ouvert le lien Google, ou n'a aucune carte Apple installée.
           (p.google_pass_url IS NOT NULL
            AND (p.google_ouvert_le IS NOT NULL
                 OR NOT EXISTS (SELECT 1 FROM device_tokens d0 WHERE d0.serial_number = c.pass_serial_number))) AS google
      FROM clients c
      LEFT JOIN passes p ON p.serial_number = c.pass_serial_number AND p.marchand_id = c.marchand_id
     WHERE c.marchand_id = p_marchand_id
       AND c.deleted_at IS NULL
       AND c.pass_serial_number IS NOT NULL
       AND (p.google_pass_url IS NOT NULL
            OR EXISTS (SELECT 1 FROM device_tokens d WHERE d.serial_number = c.pass_serial_number))
       AND NOT EXISTS (SELECT 1 FROM workflow_executions w
                        WHERE w.marchand_id = p_marchand_id AND w.client_id = c.id AND w.executed_at >= v_jour)
       AND (p_type <> 'birthday'    OR to_char(c.date_anniversaire, 'MM-DD') = v_mmjj)
       AND (p_type <> 'near_reward' OR (c.stored_value >= p_min AND c.stored_value < p_max))
       AND (p_type <> 'inactive'    OR NOT EXISTS (
             SELECT 1 FROM scans s
              WHERE s.marchand_id = p_marchand_id AND s.client_id = c.id AND s.annule_le IS NULL
                AND s.date_scan >= v_maintenant - make_interval(days => p_jours)))
  ), cand AS MATERIALIZED (
    SELECT b.* FROM base b
     WHERE CASE p_type
       WHEN 'birthday' THEN NOT EXISTS (
         SELECT 1 FROM workflow_executions w
          WHERE w.workflow_type = 'birthday' AND w.client_id = b.id AND w.executed_at >= v_annee)
       WHEN 'near_reward' THEN NOT EXISTS (
         SELECT 1 FROM workflow_executions w
          WHERE w.workflow_type = 'near_reward' AND w.client_id = b.id AND w.executed_at >= b.updated_at)
       ELSE EXISTS (
         -- Dernier scan non annulé : il doit exister (jamais scanné = exclu) et
         -- aucune relance ne doit l'avoir suivi.
         SELECT 1 FROM (SELECT max(s.date_scan) AS dernier FROM scans s
                         WHERE s.client_id = b.id AND s.annule_le IS NULL) l
          WHERE l.dernier IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM workflow_executions w
                             WHERE w.workflow_type = 'inactive' AND w.client_id = b.id AND w.executed_at > l.dernier))
     END
  ), elus AS MATERIALIZED (
    SELECT * FROM cand ORDER BY id LIMIT p_limite
  ), textes AS MATERIALIZED (
    SELECT e.*,
           replace(COALESCE(
             CASE WHEN p_type = 'near_reward' THEN p_modeles ->> (p_max - e.stored_value)::text END,
             p_modeles ->> '*'), '{prenom}', COALESCE(e.prenom, '')) AS message
      FROM elus e
  ), inscription AS (
    INSERT INTO workflow_executions (workflow_type, client_id, marchand_id, lot)
    SELECT p_type, id, p_marchand_id, p_lot FROM elus
  ), carte AS (
    UPDATE passes p SET notification_message = t.message
      FROM textes t
     WHERE p.serial_number = t.serial AND p.marchand_id = p_marchand_id
  )
  SELECT jsonb_build_object(
    'eligibles', (SELECT count(*) FROM cand),
    'clients', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'client_id', t.id, 'serial', t.serial, 'message', t.message, 'google', t.google,
               'jetons', COALESCE((SELECT jsonb_agg(d.push_token ORDER BY d.id)
                                     FROM device_tokens d WHERE d.serial_number = t.serial), '[]'::jsonb))
             ORDER BY t.id)
        FROM textes t), '[]'::jsonb))
  INTO v_resultat;

  RETURN v_resultat;
END;
$$;

-- ── cartes_google_campagne ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cartes_google_campagne(p_marchand_id uuid, p_apres uuid, p_limite integer)
RETURNS TABLE (id uuid, serial_number text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p.id, p.serial_number
    FROM passes p
   WHERE p.marchand_id = p_marchand_id
     AND p.google_pass_url IS NOT NULL
     AND (p_apres IS NULL OR p.id > p_apres)
     AND (p.google_ouvert_le IS NOT NULL
          OR NOT EXISTS (SELECT 1 FROM device_tokens d WHERE d.serial_number = p.serial_number))
   ORDER BY p.id
   LIMIT LEAST(GREATEST(p_limite, 1), 1000);
$$;

-- ── cartes_google_a_verifier ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cartes_google_a_verifier(p_apres uuid, p_limite integer)
RETURNS TABLE (id uuid, serial_number text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p.id, p.serial_number
    FROM passes p
   WHERE p.google_pass_url IS NOT NULL
     AND p.google_ouvert_le IS NULL
     AND (p_apres IS NULL OR p.id > p_apres)
     AND EXISTS (SELECT 1 FROM device_tokens d WHERE d.serial_number = p.serial_number)
   ORDER BY p.id
   LIMIT LEAST(GREATEST(p_limite, 1), 1000);
$$;

REVOKE ALL ON FUNCTION public.reserver_relances(uuid, text, uuid, jsonb, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserver_relances(uuid, text, uuid, jsonb, integer, integer, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.cartes_google_campagne(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cartes_google_campagne(uuid, uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION public.cartes_google_a_verifier(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cartes_google_a_verifier(uuid, integer) TO service_role;

COMMIT;

-- ── VÉRIFICATION (à coller juste après) ──────────────────────────────────
-- Les quatre colonnes doivent valoir true.
--
-- SELECT
--   EXISTS (SELECT 1 FROM information_schema.columns
--            WHERE table_schema = 'public' AND table_name = 'passes' AND column_name = 'google_ouvert_le') AS colonne_ok,
--   has_function_privilege('service_role', 'public.cartes_google_campagne(uuid,uuid,integer)', 'EXECUTE')
--     AND NOT has_function_privilege('anon', 'public.cartes_google_campagne(uuid,uuid,integer)', 'EXECUTE') AS campagne_ok,
--   has_function_privilege('service_role', 'public.cartes_google_a_verifier(uuid,integer)', 'EXECUTE')
--     AND NOT has_function_privilege('anon', 'public.cartes_google_a_verifier(uuid,integer)', 'EXECUTE')   AS verification_ok,
--   pg_get_functiondef('public.reserver_relances(uuid,text,uuid,jsonb,integer,integer,integer,integer)'::regprocedure)
--     LIKE '%google_ouvert_le%'                                                                             AS relances_ok;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- À n'exécuter QU'APRÈS avoir remis le code en arrière : rejouer la fonction
-- reserver_relances de migration_055_relances_en_base.sql, puis
--
-- DROP FUNCTION IF EXISTS public.cartes_google_a_verifier(uuid, integer);
-- DROP FUNCTION IF EXISTS public.cartes_google_campagne(uuid, uuid, integer);
-- (la colonne google_ouvert_le peut rester ; l'ancien code l'ignore)
