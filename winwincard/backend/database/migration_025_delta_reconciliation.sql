-- Migration 025 : réconciliation repo ↔ production (audit #3, item [3])
--
-- ── Pourquoi ce fichier existe ─────────────────────────────────────────────
-- Trois colonnes de `marchands` existaient en production sans être créées par
-- aucune migration du repo (SQL exécuté à la main, jamais committé — violation
-- de la règle §3.7 de la passation) :
--   • couleur_texte_reward  (chantier pass doré)
--   • langue                (chantier i18n FR/EN)
--   • type_programme        (chantier mode points)
-- Rejouer schema.sql + migrations 002→024 sur une base vierge produisait donc
-- un schéma où le login marchand, le scan et la génération des pass cassaient
-- (« column does not exist »). Ce delta clôt l'écart : schema.sql + 002→025
-- reproduit le schéma réel de production.
--
-- ── Source de vérité ──────────────────────────────────────────────────────
-- Photographie complète de la production du 2026-07-13 (colonnes, contraintes,
-- index, fonctions, triggers, policies), réconciliée ligne à ligne avec le
-- repo. Divergences relevées, TOUTES traitées ici :
--   1. les 3 colonnes ci-dessus, types/défauts copiés de la prod ;
--   2. leurs 2 contraintes CHECK (présentes en prod, dans aucun fichier) ;
--   3. landing_premium : nullable en prod alors que migration_013 déclare
--      NOT NULL (la version exécutée à la main différait du fichier).
-- Constats sans action : commentaires de increment_stored_value légèrement
-- différents en prod (code exécutable strictement identique à migration_023) ;
-- fonction rls_auto_enable présente en prod = outillage standard Supabase,
-- pas du schéma applicatif.
--
-- Sur la production ce fichier est un no-op intégral (tout existe déjà).
-- Rejouable sans risque.

BEGIN;

-- 1. Les 3 colonnes manquantes.
ALTER TABLE marchands
  ADD COLUMN IF NOT EXISTS couleur_texte_reward text,
  ADD COLUMN IF NOT EXISTS langue         text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS type_programme text NOT NULL DEFAULT 'stamps';

-- 2. Leurs contraintes CHECK. ADD CONSTRAINT n'a pas de IF NOT EXISTS :
--    DROP puis ADD (même pattern que migration_021), identiques à la prod.
ALTER TABLE marchands DROP CONSTRAINT IF EXISTS marchands_langue_check;
ALTER TABLE marchands ADD CONSTRAINT marchands_langue_check
  CHECK (langue IN ('fr', 'en'));

ALTER TABLE marchands DROP CONSTRAINT IF EXISTS marchands_type_programme_check;
ALTER TABLE marchands ADD CONSTRAINT marchands_type_programme_check
  CHECK (type_programme IN ('stamps', 'points'));

-- 3. Alignement sur la prod : landing_premium y est nullable.
ALTER TABLE marchands ALTER COLUMN landing_premium DROP NOT NULL;

COMMIT;
