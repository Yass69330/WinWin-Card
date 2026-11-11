-- Migration 076 : textes de la strip « illustration » modifiables (ORES, décision du pilotage du 11/11)
--
-- POURQUOI. Le sous-titre automatique du thème illustration (« YOUR 6TH FREE »,
-- « LE 12ÈME KEBAB OFFERT ») ne vaut que pour un PRODUIT offert ; il est faux
-- pour un passage offert ou un article au choix. Deux textes optionnels par
-- marchand : le texte normal et le texte de la récompense, avec {n} = le passage
-- offert (max_value + 1, écrit comme le texte automatique : 6TH, 6ÈME).
-- Vides (NULL) = texte automatique actuel : aucun marchand existant ne change.
--
-- CE QUE FAIT LA MIGRATION. Deux colonnes, même règle que strip_produit
-- (migration 043) : 40 caractères au plus, ni " < > & (le texte entre dans le
-- SVG de la strip ; le code échappe aussi, seconde ceinture).
--
-- COÛT. Deux colonnes vides ; aucune réécriture de table.
-- COMPATIBILITÉ. L'ancien code ignore les colonnes. À exécuter AVANT le code : le
-- nouveau code les LIT au scan, au téléchargement des cartes et à l'inscription
-- (deux colonnes de plus dans les lectures existantes) ; sans elles, ces
-- lectures échouent. Rejouable.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.marchands ADD COLUMN IF NOT EXISTS strip_texte text;
ALTER TABLE public.marchands ADD COLUMN IF NOT EXISTS strip_texte_recompense text;
ALTER TABLE public.marchands DROP CONSTRAINT IF EXISTS marchands_strip_texte_check;
ALTER TABLE public.marchands ADD CONSTRAINT marchands_strip_texte_check
  CHECK (strip_texte IS NULL OR (length(strip_texte) <= 40 AND strip_texte !~ '["<>&]'));
ALTER TABLE public.marchands DROP CONSTRAINT IF EXISTS marchands_strip_texte_recompense_check;
ALTER TABLE public.marchands ADD CONSTRAINT marchands_strip_texte_recompense_check
  CHECK (strip_texte_recompense IS NULL OR (length(strip_texte_recompense) <= 40 AND strip_texte_recompense !~ '["<>&]'));
COMMENT ON COLUMN public.marchands.strip_texte IS
  'Sous-titre de la strip illustration ({n} = passage offert), vide = texte automatique (migration 076).';
COMMENT ON COLUMN public.marchands.strip_texte_recompense IS
  'Sous-titre de la strip illustration à la récompense, vide = texte automatique (migration 076).';

COMMIT;

-- ── VÉRIFICATION (à coller juste après) ──────────────────────────────────
-- Une ligne, attendu : 2 | 2 | 0
--
-- SELECT
--   (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'marchands'
--     AND column_name IN ('strip_texte', 'strip_texte_recompense')) AS colonnes,
--   (SELECT count(*) FROM pg_constraint WHERE conname IN ('marchands_strip_texte_check', 'marchands_strip_texte_recompense_check')) AS garde_fous,
--   (SELECT count(*) FROM marchands WHERE strip_texte IS NOT NULL OR strip_texte_recompense IS NOT NULL) AS textes_poses;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- Remettre le code en arrière d'abord (le nouveau code lit les colonnes) ; les
-- colonnes peuvent rester (l'ancien code les ignore).
