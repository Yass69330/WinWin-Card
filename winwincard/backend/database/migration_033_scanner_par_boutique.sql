-- Migration 033 : accès scanner par boutique + attribution du scan (étape 3)
--
-- Contexte (chantier multi-boutiques, étape 3 — la plus sensible : elle prépare
-- le chemin chaud du scan). Cette migration ne fait qu'AJOUTER des colonnes ;
-- le câblage (login boutique, attribution, coupure, durcissement) viendra dans
-- le code, en lots séparés (3b, 3c), après exécution et vérif de cette migration.
--
-- Décisions validées avec le fondateur :
--   • Deux leviers distincts, jamais confondus :
--       - actif (bool) = COUPURE de l'accès scanner. Levier du FRANCHISEUR,
--         réversible, NEUTRE pour la facturation. Bloque le scan immédiatement.
--       - deleted_at   = ARCHIVAGE (migration 032). Levier de l'ADMIN, retire de
--         la facturation, conserve l'historique.
--     Le scan bloquera si actif = false OU deleted_at IS NOT NULL.
--   • Identifiants scanner PORTÉS PAR LA BOUTIQUE (une boutique = un login) :
--     scanner_login (unique, insensible à la casse) + scanner_password_hash.
--     RÈGLE D'HYGIÈNE : ne JAMAIS sélectionner scanner_password_hash hors du
--     chemin de login (les listes admin/owner ne prennent que id, nom, actif…).
--   • Attribution : scans.point_de_vente_id, rempli côté JS à l'insertion pour
--     les scans en token boutique. FK ON DELETE RESTRICT (JAMAIS cascade) — une
--     boutique qui a des scans ne peut pas être supprimée dur et emporter son
--     historique ; le soft-delete (archivage) reste la seule voie de sortie.
--
-- Garantie « aucune fenêtre sans scan possible » : le durcissement (refus du
-- token marchand dès qu'un réseau existe) sera conditionné, côté code, à
-- l'existence d'au moins une boutique active AVEC scanner_login — et la création
-- de boutique posera les identifiants dans la même opération. Le blocage ne peut
-- donc s'activer qu'une fois un login boutique utilisable en place.
--
-- Rétrocompatibilité : toutes les colonnes sont NULLABLE (ou DEFAULT sûr). Un
-- marchand mono-site (0 boutique) est strictement inchangé : scans.point_de_vente_id
-- reste NULL, aucune vérif boutique, comportement identique à aujourd'hui. AUCUNE
-- fonction touchée (increment_stored_value intacte) → hors mode d'échec juillet.
-- AUCUN grant requis (scans et points_de_vente déjà accordés à service_role).
--
-- À exécuter dans Supabase. Rejouable sans risque (IF NOT EXISTS).

-- 1) Attribution du scan à une boutique. FK RESTRICT : protège l'historique.
ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS point_de_vente_id uuid
  REFERENCES public.points_de_vente (id) ON DELETE RESTRICT;

-- Lecture par boutique (agrégations de l'étape 4). Le chemin de scan n'en a pas
-- besoin (il écrit), mais l'ajouter ici évite une migration séparée plus tard.
CREATE INDEX IF NOT EXISTS idx_scans_point_de_vente
  ON public.scans (point_de_vente_id);

-- 2) Levier de COUPURE (franchiseur). Défaut true : les boutiques existantes et
-- futures scannent normalement tant qu'on ne les coupe pas.
ALTER TABLE public.points_de_vente
  ADD COLUMN IF NOT EXISTS actif boolean NOT NULL DEFAULT true;

-- 3) Identifiants scanner de la boutique (une boutique = un login).
ALTER TABLE public.points_de_vente
  ADD COLUMN IF NOT EXISTS scanner_login         text;
ALTER TABLE public.points_de_vente
  ADD COLUMN IF NOT EXISTS scanner_password_hash text;

-- Login unique globalement (il doit résoudre vers UNE boutique au moment du
-- login), insensible à la casse. Index partiel : n'exclut que les login absents.
CREATE UNIQUE INDEX IF NOT EXISTS points_de_vente_scanner_login_unique
  ON public.points_de_vente (lower(scanner_login))
  WHERE scanner_login IS NOT NULL;
