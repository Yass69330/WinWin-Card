-- Migration 060 : le marchand règle ses smart notifications (f15, décisions du 14/10)
--
-- POURQUOI. Les relances automatiques sont réglées par l'admin (workflow_*). Le
-- marchand pourra désormais régler lui-même, depuis le bloc « Mes smart
-- notifications » : le délai d'inactivité, le message de la relance d'inactivité
-- et le seuil du boost. Il NE PEUT PAS activer ni désactiver une relance (seul
-- l'admin le fait), ni changer les textes du boost et de l'anniversaire.
--
-- RÉGLAGE ADMIN GARDÉ PAR DÉFAUT. Trois colonnes « marchand », vides par défaut.
-- Valeur utilisée par le cron = celle du marchand s'il en a mis une, sinon celle
-- de l'admin. « Revenir au réglage WinWin » = remettre les trois à NULL.
--
-- GARDE-FOUS (aussi vérifiés par le serveur, avec un message clair) :
--   - délai d'inactivité entre 7 et 90 jours ;
--   - message : non vide, 150 caractères au plus (l'absence de lien est vérifiée
--     par le serveur) ;
--   - seuil du boost ≥ 1 (le plafond « récompense − 1 » dépend du programme : le
--     serveur le vérifie ; si la récompense baisse ensuite sous le seuil, le cron
--     n'envoie pas de boost, comme aujourd'hui).
--
-- COMPTEUR. `smart_notifications_7j` : clients relancés automatiquement sur 7
-- jours glissants (workflow_executions, index marchand_id + executed_at) + clients
-- à qui une demande d'avis Google est partie (notification_envois source 'avis',
-- index marchand_id + envoye_le ; une demande écrit une ligne par appareil, on
-- compte les cartes).
--
-- COÛT. Aucune requête régulière. Le cron lit déjà la ligne du marchand une fois
-- par jour ; il y lit trois colonnes de plus.
-- COMPATIBILITÉ. L'ancien code ignore les colonnes (réglage admin). À exécuter
-- AVANT le code. Rejouable.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.marchands ADD COLUMN IF NOT EXISTS marchand_inactive_days         integer;
ALTER TABLE public.marchands ADD COLUMN IF NOT EXISTS marchand_inactive_message      text;
ALTER TABLE public.marchands ADD COLUMN IF NOT EXISTS marchand_near_reward_threshold integer;

ALTER TABLE public.marchands DROP CONSTRAINT IF EXISTS marchands_reglages_smart_check;
ALTER TABLE public.marchands ADD CONSTRAINT marchands_reglages_smart_check CHECK (
  (marchand_inactive_days IS NULL OR marchand_inactive_days BETWEEN 7 AND 90)
  AND (marchand_inactive_message IS NULL OR (length(btrim(marchand_inactive_message)) BETWEEN 1 AND 150))
  AND (marchand_near_reward_threshold IS NULL OR marchand_near_reward_threshold >= 1)
);

COMMENT ON COLUMN public.marchands.marchand_inactive_days IS
  'Réglé par le marchand (NULL = réglage admin workflow_inactive_days). 7 à 90 jours (migration 060).';
COMMENT ON COLUMN public.marchands.marchand_inactive_message IS
  'Réglé par le marchand (NULL = réglage admin workflow_inactive_message). 150 caractères, sans lien (migration 060).';
COMMENT ON COLUMN public.marchands.marchand_near_reward_threshold IS
  'Réglé par le marchand (NULL = réglage admin workflow_near_reward_threshold). 1 à récompense − 1 (migration 060).';

CREATE OR REPLACE FUNCTION public.smart_notifications_7j(p_marchand_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT ((SELECT count(*) FROM workflow_executions
            WHERE marchand_id = p_marchand_id AND executed_at >= now() - interval '7 days')
        + (SELECT count(DISTINCT serial_number) FROM notification_envois
            WHERE marchand_id = p_marchand_id AND envoye_le >= now() - interval '7 days' AND source = 'avis'))::integer;
$$;

REVOKE ALL ON FUNCTION public.smart_notifications_7j(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.smart_notifications_7j(uuid) TO service_role;

COMMIT;

-- ── VÉRIFICATION (à coller juste après) ──────────────────────────────────
-- Les trois colonnes doivent valoir true.
--
-- SELECT
--   (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'marchands'
--     AND column_name IN ('marchand_inactive_days', 'marchand_inactive_message', 'marchand_near_reward_threshold')) = 3 AS colonnes_ok,
--   EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marchands_reglages_smart_check') AS garde_fous_ok,
--   has_function_privilege('service_role', 'public.smart_notifications_7j(uuid)', 'EXECUTE')
--     AND NOT has_function_privilege('anon', 'public.smart_notifications_7j(uuid)', 'EXECUTE') AS droits_ok;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- Après avoir remis le code en arrière (l'ancien code ignore tout ceci) :
--   DROP FUNCTION IF EXISTS public.smart_notifications_7j(uuid);
--   ALTER TABLE public.marchands DROP CONSTRAINT IF EXISTS marchands_reglages_smart_check;
--   (les trois colonnes peuvent rester ; les supprimer efface les réglages des marchands)
