-- Migration 064 : index des campagnes ciblées (t42, 18/10)
--
-- POURQUOI. Compter ou envoyer une campagne ciblée (inactifs, fidèles) évalue
-- chaque client avec client_dans_segment (059). Deux lectures par client y
-- relisaient une tranche entière du marchand :
--   - « pas relancé aujourd'hui » : toutes les relances du jour du marchand
--     (idx_wf_exec_marchand_date) ;
--   - « fidèles » : le plan générique croisait idx_scans_client avec
--     idx_scans_marchand_date, donc les scans du mois du marchand.
-- Coût en carré de la taille : au banc, 50 000 porteurs → inactifs ≈ 40 s,
-- fidèles ≈ 182 s (503 à 5 s dès ≈ 8 000 porteurs pour fidèles, ≈ 15 000 pour
-- inactifs). Avec ces deux index : ≈ 2 s pour tous les segments, lot « fidèles »
-- 2,2 s (passation §15 novoquinquagies).
--
-- CE QUE FAIT LA MIGRATION.
--   - scans (client_id, date_scan) REMPLACE idx_scans_client (client_id) : même
--     colonne de tête, il sert toutes les lectures de l'ancien (fiche client,
--     effacement, segments). Même nombre d'index sur scans : coût d'écriture du
--     scan inchangé (mesuré au banc, écart dans le bruit) ;
--   - workflow_executions (client_id, executed_at) : écrit par le cron seulement
--     (relances), jamais par la caisse.
--
-- VERROU. CREATE INDEX simple, comme 037 : les tables sont petites aujourd'hui,
-- la construction prend une fraction de seconde (les scans attendent ce temps).
-- Sur une grosse table, lancer à la place, UNE instruction à la fois :
--   CREATE INDEX CONCURRENTLY ... ; puis DROP INDEX CONCURRENTLY ... ;
--
-- COMPATIBILITÉ. Aucun code ne dépend de ces index : à exécuter avant ou après
-- le push. Rejouable.
-- À exécuter dans Supabase.

CREATE INDEX IF NOT EXISTS idx_scans_client_date
  ON public.scans (client_id, date_scan);

CREATE INDEX IF NOT EXISTS idx_wf_exec_client_date
  ON public.workflow_executions (client_id, executed_at);

DROP INDEX IF EXISTS public.idx_scans_client;

-- ── VÉRIFICATION (à coller juste après) : trois colonnes à true ────────────
-- SELECT to_regclass('public.idx_scans_client_date')   IS NOT NULL AS scans_ok,
--        to_regclass('public.idx_wf_exec_client_date') IS NOT NULL AS relances_ok,
--        to_regclass('public.idx_scans_client')        IS NULL     AS ancien_retire;
--
-- ── RETOUR ARRIÈRE ───────────────────────────────────────────────────────
-- CREATE INDEX IF NOT EXISTS idx_scans_client ON public.scans (client_id);
-- DROP INDEX IF EXISTS public.idx_scans_client_date;
-- DROP INDEX IF EXISTS public.idx_wf_exec_client_date;
