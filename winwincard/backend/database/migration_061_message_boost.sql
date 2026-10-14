-- Migration 061 : message du boost modifiable (f18, décisions du 14/10)
--
-- POURQUOI. Le texte du boost (« plus que N points pour ta récompense ») était
-- fixe partout. Il devient modifiable par l'admin (réglage WinWin) ET par le
-- marchand (son réglage, qui l'emporte), comme le message d'inactivité de f15.
-- Le texte actuel devient le texte WinWin par défaut (NULL = texte standard).
--
-- RÈGLES (vérifiées par le serveur avec un message clair ; la base garde la
-- forme) : 150 caractères au plus, mot réservé {reste} obligatoire (nombre
-- restant + unité, singulier ou pluriel), sans lien (vérifié par le serveur).
-- « Revenir au réglage WinWin » efface aussi le message du marchand.
--
-- COÛT. Deux colonnes texte. Le cron lit déjà la ligne du marchand. Aucune
-- requête régulière. COMPATIBILITÉ : l'ancien code ignore les colonnes (texte
-- standard). À exécuter AVANT le code. Rejouable.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.marchands ADD COLUMN IF NOT EXISTS workflow_near_reward_message text;
ALTER TABLE public.marchands ADD COLUMN IF NOT EXISTS marchand_near_reward_message text;

ALTER TABLE public.marchands DROP CONSTRAINT IF EXISTS marchands_message_boost_check;
ALTER TABLE public.marchands ADD CONSTRAINT marchands_message_boost_check CHECK (
  (workflow_near_reward_message IS NULL
     OR (length(btrim(workflow_near_reward_message)) BETWEEN 1 AND 150 AND position('{reste}' IN workflow_near_reward_message) > 0))
  AND (marchand_near_reward_message IS NULL
     OR (length(btrim(marchand_near_reward_message)) BETWEEN 1 AND 150 AND position('{reste}' IN marchand_near_reward_message) > 0))
);

COMMENT ON COLUMN public.marchands.workflow_near_reward_message IS
  'Message du boost, réglage WinWin (admin). NULL = texte standard. {reste} obligatoire (migration 061).';
COMMENT ON COLUMN public.marchands.marchand_near_reward_message IS
  'Message du boost réglé par le marchand (NULL = réglage WinWin). {reste} obligatoire (migration 061).';

COMMIT;

-- ── VÉRIFICATION (à coller juste après) ──────────────────────────────────
-- Les deux colonnes doivent valoir true.
--
-- SELECT
--   (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'marchands'
--     AND column_name IN ('workflow_near_reward_message', 'marchand_near_reward_message')) = 2 AS colonnes_ok,
--   EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marchands_message_boost_check') AS garde_fou_ok;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- Après avoir remis le code en arrière (l'ancien code ignore les colonnes) :
--   ALTER TABLE public.marchands DROP CONSTRAINT IF EXISTS marchands_message_boost_check;
--   (les colonnes peuvent rester ; les supprimer efface les messages saisis)
