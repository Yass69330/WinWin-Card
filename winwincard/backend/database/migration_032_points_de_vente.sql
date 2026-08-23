-- Migration 032 : table points_de_vente (chantier multi-boutiques, étape 2)
--
-- Contexte. Un réseau reste UN SEUL marchand ; les points de vente sont ses
-- enfants, purement analytiques. Cette table permet au propriétaire du groupe
-- de créer et gérer ses boutiques depuis le dashboard. À ce stade elle n'est
-- lue par AUCUNE surface métier : ni le scan, ni l'inscription, ni le pass, ni
-- les workflows ne la connaissent. L'attribution du scan à une boutique arrive
-- à l'étape 3 (via scans.point_de_vente_id, une autre migration).
--
-- GRANT service_role OBLIGATOIRE : une table créée par migration n'a AUCUN
-- droit DML pour service_role par défaut (leçon des migrations 028/030). Sans
-- ce grant, le backend — clé service_role via PostgREST — ne pourrait pas y
-- écrire, en silence. On le pose donc explicitement, comme pour notification_logs.
--
-- Archivage, pas suppression : deleted_at (même motif que clients). Une boutique
-- qui a de l'historique n'est jamais supprimée dur → son activité reste dans les
-- chiffres du réseau. La colonne de COUPURE d'accès scanner (révocation immédiate
-- au scan) est volontairement REPORTÉE à l'étape 3 : elle n'a de sens qu'avec les
-- accès scanner par boutique, et rien n'est perdu à attendre.
--
-- Unicité : deux boutiques ACTIVES d'un même réseau ne peuvent pas porter le
-- même nom (insensible à la casse) — un doublon rendrait illisibles les stats de
-- l'étape 4. L'index partiel n'exclut que les boutiques archivées (deleted_at).
--
-- Non-régression : table purement additive. Un marchand mono-site n'a aucune
-- ligne ici → l'UI boutique reste masquée (condition count > 0 côté dashboard),
-- et tous les chemins existants sont strictement inchangés.
--
-- À exécuter dans Supabase. Rejouable sans risque (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS public.points_de_vente (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  marchand_id uuid        NOT NULL REFERENCES public.marchands (id) ON DELETE CASCADE,
  nom         text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- Recherche des boutiques d'un réseau (liste dashboard, agrégations étape 4).
CREATE INDEX IF NOT EXISTS idx_points_de_vente_marchand
  ON public.points_de_vente (marchand_id);

-- Nom unique par réseau, insensible à la casse, sur les boutiques actives only.
-- (Le code doit trim() le nom en entrée ; la casse est neutralisée ici via lower.)
CREATE UNIQUE INDEX IF NOT EXISTS points_de_vente_nom_actif_unique
  ON public.points_de_vente (marchand_id, lower(nom))
  WHERE deleted_at IS NULL;

-- DML pour le backend (service_role). Miroir de migration_006 / 028 / 030.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.points_de_vente TO service_role;
