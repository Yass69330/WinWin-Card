-- Migration 043 : thème de strip « illustration » (étape 2/4)
--
-- Contexte. Nouveau thème à côté de logo_stamp et icon_metier. Premier client :
-- Hilal Kebab (11 tampons, le 12e offert), les autres kebabs lyonnais suivront
-- avec le même thème — seuls le logo et les couleurs changent d'un client à
-- l'autre. Une illustration est MULTICOLORE à couleurs figées, contrairement aux
-- icônes Phosphor qui sont monochromes et recoloriées par la palette WCAG.
--
-- CETTE MIGRATION EST INERTE POUR LE CODE DÉPLOYÉ. Aucune des trois colonnes
-- n'est lue par quoi que ce soit au moment où elle est exécutée : ni les 6
-- listes SELECT explicites, ni ALLOWED, ni VISUAL_FIELDS. Elle ouvre seulement
-- la porte que l'étape 3 (branche de rendu) et l'étape 4 (admin) franchiront.
--
-- CONTRAINTE strip_theme : pourquoi un bloc DO. La contrainte d'origine
-- (migration 018) est posée EN LIGNE dans le ADD COLUMN, donc son nom peut être
-- auto-généré ; la migration 021 l'a ensuite remplacée par une contrainte
-- nommée. On ne peut pas présumer du nom : on retire par introspection toute
-- contrainte CHECK portant sur strip_theme, quel que soit son nom. Même patron
-- que la migration 040 pour strip_mode.
--
-- GARDE-FOU. Si strip_theme contient une valeur hors des trois attendues, la
-- migration lève une exception et la transaction entière est annulée — aucune
-- colonne n'est créée. Tout ou rien.
--
-- lock_timeout. Les ALTER prennent un ACCESS EXCLUSIVE sur marchands. Sur 45
-- lignes la durée réelle est sous les 10 ms ; le danger n'est pas là mais dans
-- la FILE D'ATTENTE — une demande d'ACCESS EXCLUSIVE bloque toutes les requêtes
-- suivantes tant qu'elle attend derrière une transaction ouverte. Le timeout
-- fait échouer proprement plutôt que geler les scans.
--
-- AUCUN GRANT nécessaire : on ajoute des colonnes à une table existante, les
-- droits de service_role sur marchands sont inchangés.
--
-- Vérifiée avant exécution sur un PostgreSQL 16 local, sur une table
-- reconstituée à l'état post-018/021 avec 45 marchands : contraintes de forme
-- confirmées (majuscules, « ../ », guillemets, chevrons et 25 caractères
-- refusés), rejouabilité confirmée, garde-fou confirmé, retour arrière confirmé.
--
-- Exécutée en production. À NE PAS REJOUER — sans effet, mais inutile.

BEGIN;
SET lock_timeout = '3s';

-- 1) Élargir strip_theme à 'illustration', sans présumer du nom de contrainte.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname='public' AND rel.relname='marchands'
      AND con.contype='c' AND pg_get_constraintdef(con.oid) LIKE '%strip_theme%'
  LOOP
    EXECUTE format('ALTER TABLE public.marchands DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.marchands
   WHERE strip_theme IS NOT NULL
     AND strip_theme NOT IN ('logo_stamp','icon_metier','illustration');
  IF n > 0 THEN
    RAISE EXCEPTION 'strip_theme contient % valeur(s) inattendue(s)', n;
  END IF;
END $$;

ALTER TABLE public.marchands
  ADD CONSTRAINT marchands_strip_theme_check
  CHECK (strip_theme IN ('logo_stamp','icon_metier','illustration'));

-- 2) Illustration choisie dans le registre src/services/illustrations/.
--    La forme est bornée ici ET validée au PATCH admin contre les clés
--    réellement présentes dans le registre (étape 4) : la base garantit la
--    forme, le code garantit l'existence.
ALTER TABLE public.marchands
  ADD COLUMN IF NOT EXISTS strip_illustration text
  CHECK (strip_illustration IS NULL OR strip_illustration ~ '^[a-z0-9_-]{1,32}$');

-- 3) Nom du produit pour le sous-titre (« KEBAB » → « LE 12ÈME KEBAB OFFERT »).
--    Les caractères " < > & sont refusés : ce texte est injecté dans un SVG.
ALTER TABLE public.marchands
  ADD COLUMN IF NOT EXISTS strip_produit text
  CHECK (strip_produit IS NULL OR (length(strip_produit) <= 24 AND strip_produit !~ '["<>&]'));

-- 4) Rendu du passage RESTANT en thème illustration.
--    NULL = 'illustration' (même dessin en faible opacité). 'logo' est réservé
--    aux logos à canal alpha réel : les logos réels sont souvent récupérés sur
--    Instagram, en basse résolution et à fond opaque, et rendent mal sur un
--    disque sombre. L'aperçu admin avertira avant d'autoriser ce mode.
ALTER TABLE public.marchands
  ADD COLUMN IF NOT EXISTS strip_vide text
  CHECK (strip_vide IS NULL OR strip_vide IN ('illustration','logo'));

COMMIT;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- Vérifié sur PostgreSQL 16 : restaure l'état exact d'avant la migration.
--
-- BEGIN;
-- SET lock_timeout = '3s';
-- ALTER TABLE public.marchands DROP COLUMN IF EXISTS strip_vide;
-- ALTER TABLE public.marchands DROP COLUMN IF EXISTS strip_produit;
-- ALTER TABLE public.marchands DROP COLUMN IF EXISTS strip_illustration;
-- UPDATE public.marchands SET strip_theme='icon_metier' WHERE strip_theme='illustration';
-- ALTER TABLE public.marchands DROP CONSTRAINT IF EXISTS marchands_strip_theme_check;
-- ALTER TABLE public.marchands
--   ADD CONSTRAINT marchands_strip_theme_check
--   CHECK (strip_theme IN ('logo_stamp','icon_metier'));
-- COMMIT;
