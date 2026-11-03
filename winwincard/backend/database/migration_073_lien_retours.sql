-- Migration 073 : lien « Vos retours et conseils » au dos des cartes (f20, phase test,
-- décisions du pilotage du 04/11)
--
-- POURQUOI. Un canal d'avis PRIVÉ (formulaire du marchand, Google Form) au dos de
-- la carte, distinct de lien_avis_google (avis Google public + notification après
-- scan). Demande sur mesure pour Pizz'amore ; champ par marchand saisi dans
-- l'admin, vide = rien affiché (tous les autres marchands).
--
-- CE QUE FAIT LA MIGRATION. Une colonne marchands.lien_retours (URL, 500
-- caractères au plus ; la forme https est contrôlée par le serveur).
--
-- COÛT. Une colonne vide ; aucune réécriture de table.
-- COMPATIBILITÉ. L'ancien code ignore la colonne. À exécuter AVANT le code :
-- le nouveau code la LIT au scan, au téléchargement des cartes et à l'inscription
-- (une colonne de plus dans les lectures existantes) ; sans elle, ces lectures
-- échouent. Rejouable.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.marchands ADD COLUMN IF NOT EXISTS lien_retours text;
ALTER TABLE public.marchands DROP CONSTRAINT IF EXISTS marchands_lien_retours_check;
ALTER TABLE public.marchands ADD CONSTRAINT marchands_lien_retours_check
  CHECK (lien_retours IS NULL OR length(lien_retours) <= 500);
COMMENT ON COLUMN public.marchands.lien_retours IS
  'Lien « Vos retours et conseils » au dos des cartes (formulaire privé du marchand), vide = aucun (f20, migration 073).';

COMMIT;

-- ── VÉRIFICATION (à coller juste après) ──────────────────────────────────
-- Une ligne, attendu : true | true | 0
--
-- SELECT
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
--            AND table_name = 'marchands' AND column_name = 'lien_retours') AS colonne_ok,
--   EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marchands_lien_retours_check') AS garde_fou_ok,
--   (SELECT count(*) FROM marchands WHERE lien_retours IS NOT NULL) AS liens_poses;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- Remettre le code en arrière d'abord (le nouveau code lit la colonne), puis la
-- colonne peut rester (l'ancien code l'ignore).
