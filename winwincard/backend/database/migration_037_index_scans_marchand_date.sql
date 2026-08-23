-- Migration 037 : index composite (marchand_id, date_scan) sur scans (étape 4)
--
-- Contexte. group_stats (036) lit les scans d'un marchand sur 90 jours :
--   WHERE marchand_id = $1 AND date_scan >= now() - interval '90 days'
-- Sans composite, Postgres utilise idx_scans_marchand (marchand_id seul) → il lit
-- TOUT l'historique du marchand puis filtre la date en mémoire. À l'échelle d'un
-- réseau ancien, c'est beaucoup de lignes lues pour rien.
--
-- Ce composite permet un range scan direct sur (marchand_id, date_scan) → seule
-- la tranche de 90 jours est lue. Il sert aussi /me/stats (même motif marchand+date).
--
-- Additif pur, aucune donnée/fonction touchée, aucun grant. La table scans est
-- petite aujourd'hui → CREATE INDEX (verrou bref) est quasi instantané. (Si un
-- jour la table était volumineuse, on utiliserait CREATE INDEX CONCURRENTLY hors
-- transaction ; inutile à ce volume.) Rejouable (IF NOT EXISTS).
--
-- À exécuter dans Supabase.

CREATE INDEX IF NOT EXISTS idx_scans_marchand_date
  ON public.scans (marchand_id, date_scan);
