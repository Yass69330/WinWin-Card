-- Migration 049 : suivi du passage quotidien du cron (étape 5, supervision)
--
-- POURQUOI. Le cron de 08:00 UTC (workers/cron.js) ne laissait que deux lignes de
-- journal, « Démarrage » et « terminés », gardées 7 jours par Railway, sans
-- aucune alerte. « terminés » s'affichait même si les trois workflows avaient
-- échoué, et le registre des envois n'écrit que lorsqu'il y a un envoi : un jour
-- sans ligne ne prouvait rien. Un cron qui ne démarre pas (serveur redémarré vers
-- 08:00 : node-cron ne rattrape pas un passage manqué) ou qui ne finit pas
-- (redéploiement pendant le passage) passait inaperçu.
--
-- CE QUE FAIT LA TABLE. Une ligne par passage planifié : écrite au début
-- (statut 'en_cours'), complétée à la fin (fin, statut 'ok' ou 'erreurs',
-- bilan des envois par workflow). La route /health/cron la lit ; UptimeRobot
-- surveille la route et alerte par e-mail sur un 503.
--
-- Le déclenchement manuel depuis l'admin (/api/admin/workflows/trigger) n'écrit
-- PAS ici : seul le passage planifié est suivi.
--
-- VOLUME : une ligne par jour. Aucune purge prévue (≈ 365 lignes par an).
--
-- DROITS. GRANT explicite à service_role (leçon de 028 et 030 : une table créée
-- par migration n'a aucun droit de lecture ni d'écriture pour le serveur). Pas de
-- DELETE : rien ne supprime de ligne. RLS active, sans policy : invisible pour
-- anon et authenticated. (Le déclencheur ensure_rls, migration 048, l'aurait
-- activée de toute façon ; l'écrire ici garde le fichier vrai tout seul.)
--
-- À exécuter dans Supabase AVANT de déployer le code qui écrit dans la table.
-- Sans elle, le cron tourne normalement mais n'est pas suivi (écriture refusée,
-- journalisée) et /health/cron répond 503 « lecture_impossible ». Rejouable.

BEGIN;
SET lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.cron_passages (
  id        bigserial   PRIMARY KEY,
  debut     timestamptz NOT NULL DEFAULT now(),
  fin       timestamptz,
  statut    text        NOT NULL DEFAULT 'en_cours'
            CONSTRAINT cron_passages_statut_check CHECK (statut IN ('en_cours', 'ok', 'erreurs')),
  -- Instance qui a fait le passage : deux lignes le même matin = cron doublé
  -- (plusieurs instances Railway, 00b F5).
  instance  text,
  -- { "bilan": { "inactive": n, ... }, "erreurs": ["near_reward", ...] }
  details   jsonb
);

CREATE INDEX IF NOT EXISTS idx_cron_passages_debut
  ON public.cron_passages (debut DESC);

COMMENT ON TABLE public.cron_passages IS
  'Une ligne par passage planifié du cron (08:00 UTC). Lue par /health/cron, surveillée par UptimeRobot.';

ALTER TABLE public.cron_passages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.cron_passages TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cron_passages_id_seq TO service_role;

COMMIT;

-- ── VÉRIFICATION (à coller juste après) ──────────────────────────────────
-- Les quatre colonnes doivent valoir true.
--
-- SELECT
--   to_regclass('public.cron_passages') IS NOT NULL                          AS table_ok,
--   has_table_privilege('service_role', 'public.cron_passages', 'INSERT')
--     AND has_table_privilege('service_role', 'public.cron_passages', 'UPDATE')
--     AND has_table_privilege('service_role', 'public.cron_passages', 'SELECT') AS droits_ok,
--   has_sequence_privilege('service_role', 'public.cron_passages_id_seq', 'USAGE') AS sequence_ok,
--   (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cron_passages'::regclass) AS rls_ok;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- À n'exécuter QU'APRÈS avoir remis le code en arrière (sinon le cron journalise
-- une erreur de suivi à chaque passage, sans autre effet).
--
-- DROP TABLE IF EXISTS public.cron_passages;
