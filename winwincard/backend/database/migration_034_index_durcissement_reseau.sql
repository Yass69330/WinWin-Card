-- Migration 034 : index partiel pour le durcissement du token marchand (étape 3c)
--
-- Contexte. En 3c, chaque scan en TOKEN MARCHAND (donc tous les mono-sites
-- actuels + l'amorçage réseau) exécutera une vérification de durcissement :
--   « ce marchand a-t-il au moins une boutique ACTIVE (non archivée) qui possède
--     des identifiants scanner ? »
--       → OUI  : réseau provisionné → le token marchand est refusé (sécurité).
--       → NON  : mono-site → comportement actuel, scan autorisé, point_de_vente NULL.
-- Requête correspondante :
--   SELECT 1 FROM points_de_vente
--   WHERE marchand_id = $1 AND deleted_at IS NULL AND scanner_login IS NOT NULL
--   LIMIT 1;
--
-- Cet index PARTIEL n'indexe QUE les boutiques « provisionnées » (login posé,
-- non archivées). Pour un mono-site, il ne contient AUCUNE entrée le concernant
-- → la vérification est un test d'existence quasi instantané, sur le chemin chaud.
-- (deleted_at et scanner_login sont dans le prédicat de l'index, pas colonnes
-- indexées : le partiel suffit, on filtre juste par marchand_id.)
--
-- Additif pur : un simple index. Aucune donnée modifiée, aucune fonction touchée,
-- aucun grant requis. La table points_de_vente est minuscule → CREATE INDEX
-- (verrou bref, non concurrent) est instantané. Rejouable (IF NOT EXISTS).
--
-- À exécuter dans Supabase AVANT le déploiement du code 3c qui s'appuie dessus.

CREATE INDEX IF NOT EXISTS idx_points_de_vente_reseau_actif
  ON public.points_de_vente (marchand_id)
  WHERE deleted_at IS NULL AND scanner_login IS NOT NULL;
