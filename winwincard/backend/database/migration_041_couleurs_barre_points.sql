-- Migration 041 : couleurs modulables de la barre de progression (mode points)
--
-- CONTEXTE
-- Le strip 'points_bar' (migration 040) dessine une barre de progression et le
-- solde du client. Jusqu'ici il empruntait les couleurs des pastilles
-- (couleur_pastille_*), ce qui était un raccourci : une pastille et une barre
-- n'ont rien à voir, et un marchand en points n'a pas de pastilles à régler.
--
-- DEUX RÉGLAGES, PAS QUATRE (arbitrage fondateur)
-- Le découpage naturel n'est pas « un réglage par élément » mais « ce qui a
-- progressé » contre « ce qui reste à parcourir » :
--   • couleur_barre_principale → le REMPLISSAGE de la barre ET le CHIFFRE
--   • couleur_barre_secondaire → la PISTE (creux) ET le « SUR 2000 »
-- Deux champs au lieu de quatre dans l'admin, et un marchand ne peut pas
-- fabriquer une combinaison incohérente.
--
-- NULLABLE = ZÉRO RÉGRESSION
-- NULL → calcul WCAG automatique depuis couleur_fond, exactement comme les
-- pastilles aujourd'hui. Un marchand qui ne règle rien obtient un rendu
-- correct et contrasté sans rien faire. Aucune valeur par défaut n'est posée.
--
-- LE CHECK ANTI-CASSE
-- Ces valeurs sont injectées telles quelles dans un attribut SVG. Un guillemet
-- ou un chevron y romprait le XML : la génération échouerait et le strip
-- retomberait silencieusement sur un bandeau uni. Le CHECK interdit
-- EXACTEMENT ces trois caractères et rien d'autre — tous les formats CSS
-- valides passent (#rrggbb, #rgb, rgba(...), transparent, noms de couleurs).
-- Volontairement permissif : une contrainte trop stricte rejetterait des
-- valeurs légitimes, ce qui serait pire que le problème qu'elle corrige.
--
-- Aucune donnée existante n'est modifiée. Aucun marchand ne change de
-- comportement : ces colonnes sont vides pour tout le monde à l'issue de la
-- migration. Rejouable. À exécuter dans l'éditeur SQL Supabase.

BEGIN;

ALTER TABLE public.marchands
  ADD COLUMN IF NOT EXISTS couleur_barre_principale text,
  ADD COLUMN IF NOT EXISTS couleur_barre_secondaire text;

-- Contraintes posées à part (et non en ligne) pour qu'elles portent un nom
-- explicite — la leçon de la migration 040, où le nom auto-généré de la 018
-- a fallu être retrouvé par introspection.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.marchands'::regclass
      AND conname  = 'marchands_couleur_barre_principale_check'
  ) THEN
    ALTER TABLE public.marchands
      ADD CONSTRAINT marchands_couleur_barre_principale_check
      CHECK (couleur_barre_principale IS NULL OR couleur_barre_principale !~ '["<>]');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.marchands'::regclass
      AND conname  = 'marchands_couleur_barre_secondaire_check'
  ) THEN
    ALTER TABLE public.marchands
      ADD CONSTRAINT marchands_couleur_barre_secondaire_check
      CHECK (couleur_barre_secondaire IS NULL OR couleur_barre_secondaire !~ '["<>]');
  END IF;
END $$;

COMMIT;

-- ── Contrôle final ─────────────────────────────────────────────────────────
-- Doit renvoyer 2 lignes, toutes deux nullable = YES, sans valeur par défaut.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'marchands'
  AND column_name LIKE 'couleur_barre_%'
ORDER BY column_name;
