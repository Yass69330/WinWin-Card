-- Migration 055 : sélection des relances automatiques DANS LA BASE (étape 22 et
-- partie cron de l'étape 21)
--
-- POURQUOI. Le cron lisait clients, scans récents et relances passées par l'API
-- de données, coupées à 1 000 lignes, puis triait en JS. Effets constatés au
-- palier 50 000 (étape 15) : des clients ACTIFS relancés comme inactifs, des
-- clients jamais évalués, des doublons, des anniversaires manqués. Les scans
-- annulés comptaient comme des visites. Chaque relance coûtait 3 requêtes en
-- série (57 min de cron). Diagnostic : PASSATION §15 tertricies.
--
-- RÈGLES (décisions de Yass, 12/10) :
--   - inactive : UNE relance par absence. Éligible si le dernier scan NON annulé
--     date de plus de N jours (réglage du marchand) ET qu'aucune relance n'a été
--     faite depuis ce scan. Un client qui n'a jamais scanné n'est pas relancé.
--   - near_reward : une relance par palier. Éligible si le solde est dans la zone
--     ET qu'aucune relance near_reward n'a été faite depuis le dernier changement
--     de la fiche du client (clients.updated_at, posé par le déclencheur à chaque
--     scan, annulation, ajustement ou parrainage).
--   - birthday : une par an, le jour (UTC) de l'anniversaire.
--   - au plus UNE relance par client et par jour UTC, tous types confondus ; la
--     priorité vient de l'ordre du passage (birthday → near_reward → inactive).
--   - un client sans aucun canal (ni jeton Apple, ni carte Google) n'est pas pris.
--
-- CE QUE FAIT LA MIGRATION.
--   - `workflow_executions.lot` : relie une relance aux lignes du registre des
--     envois (notification_envois.lot), pour le futur rapport du marchand.
--   - index `(marchand_id, executed_at)` : règle « une par jour » et rapport.
--     L'index existant `idx_wf_exec_lookup` (type, client, …) sert les contrôles
--     par client ; il est gardé.
--   - `reserver_relances` : en UNE transaction, verrou par marchand (le cron de
--     08:00 et le bouton admin passent l'un après l'autre), sélection sans
--     plafond de lecture, au plus p_limite élus (par id croissant), inscription
--     dans workflow_executions AVANT l'envoi (un crash perd au pire ce lot,
--     jamais de doublon), texte posé sur la carte. Rend le nombre d'éligibles et
--     les élus avec leurs jetons Apple et l'existence d'une carte Google.
--     Appelée de nouveau, elle prend les suivants : pas de curseur.
--   - `purger_workflow_executions` : purge à 90 j comme avant, MAIS garde la
--     dernière ligne de chaque (client, type) : sans elle, « une relance par
--     absence » redeviendrait éligible au bout de 90 jours. Les lignes des
--     clients effacés (RGPD) partent au même âge.
--
-- VOLUME : au plus une ligne par client et par jour ; avec les nouvelles règles,
-- quelques lignes par client et par an. Index ≈ 10 à 15 Mo au palier 50 000.
--
-- DROITS. Fonctions : REVOKE à PUBLIC, anon, authenticated ; EXECUTE à
-- service_role (droits de table déjà en place, migration 028).
--
-- À exécuter dans Supabase AVANT de déployer le code de l'étape 22. Sans elle, le
-- cron échoue marchand par marchand (fonction absente) et le passage finit en
-- « erreurs » ; rien ne part. Rejouable.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.workflow_executions ADD COLUMN IF NOT EXISTS lot uuid;

CREATE INDEX IF NOT EXISTS idx_wf_exec_marchand_date
  ON public.workflow_executions (marchand_id, executed_at);

COMMENT ON TABLE public.workflow_executions IS
  'Relances automatiques (une ligne par client relancé) : dédoublonnage et futur rapport marchand. Purge à 90 jours, sauf la dernière ligne de chaque (client, type).';

-- ── reserver_relances ───────────────────────────────────────────────────────
-- p_modeles : textes déjà prêts, avec « {prenom} » à remplacer. Clé '*' = texte
-- par défaut ; pour near_reward, une clé par nombre de points restants ('1',
-- '2', …), car le texte dépend du pluriel.
-- p_jours (inactive), p_min et p_max (near_reward : zone [p_min, p_max[).
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
           (p.google_pass_url IS NOT NULL) AS google
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

-- ── purger_workflow_executions ──────────────────────────────────────────────
-- Rend le nombre de lignes supprimées.
CREATE OR REPLACE FUNCTION public.purger_workflow_executions(p_avant timestamptz)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM workflow_executions w
   WHERE w.executed_at < p_avant
     AND (EXISTS (SELECT 1 FROM workflow_executions r
                   WHERE r.workflow_type = w.workflow_type AND r.client_id = w.client_id
                     AND r.executed_at > w.executed_at)
          OR EXISTS (SELECT 1 FROM clients c WHERE c.id = w.client_id AND c.deleted_at IS NOT NULL));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.reserver_relances(uuid, text, uuid, jsonb, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserver_relances(uuid, text, uuid, jsonb, integer, integer, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.purger_workflow_executions(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purger_workflow_executions(timestamptz) TO service_role;

COMMIT;

-- ── VÉRIFICATION (à coller juste après) ──────────────────────────────────
-- Les cinq colonnes doivent valoir true.
--
-- SELECT
--   EXISTS (SELECT 1 FROM information_schema.columns
--            WHERE table_schema = 'public' AND table_name = 'workflow_executions' AND column_name = 'lot') AS colonne_ok,
--   to_regclass('public.idx_wf_exec_marchand_date') IS NOT NULL                                   AS index_ok,
--   has_function_privilege('service_role', 'public.reserver_relances(uuid,text,uuid,jsonb,integer,integer,integer,integer)', 'EXECUTE')
--     AND NOT has_function_privilege('anon', 'public.reserver_relances(uuid,text,uuid,jsonb,integer,integer,integer,integer)', 'EXECUTE') AS reserver_ok,
--   has_function_privilege('service_role', 'public.purger_workflow_executions(timestamptz)', 'EXECUTE')
--     AND NOT has_function_privilege('anon', 'public.purger_workflow_executions(timestamptz)', 'EXECUTE') AS purger_ok,
--   has_table_privilege('service_role', 'public.workflow_executions', 'INSERT')                   AS droits_ok;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- À n'exécuter QU'APRÈS avoir remis le code en arrière. La colonne et l'index
-- peuvent rester (l'ancien code les ignore).
--
-- DROP FUNCTION IF EXISTS public.purger_workflow_executions(timestamptz);
-- DROP FUNCTION IF EXISTS public.reserver_relances(uuid, text, uuid, jsonb, integer, integer, integer, integer);
