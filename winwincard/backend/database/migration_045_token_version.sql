-- Migration 045 : révocation des jetons marchand (chantier P0 sécurité, cas b)
--
-- CONTEXTE. `authMarchand` ne consultait RIEN en base : ni `actif`, ni le mot de
-- passe. Aucune des 14 routes qu'il protège ne vérifiait `actif` non plus, dont
-- 5 qui écrivent (POST /notifications, PATCH et DELETE /clients/:id,
-- PATCH /me/points-de-vente/:id et /actif). Un jeton marchand était donc
-- irrévocable pendant toute sa durée de vie — passée à 365 jours le 21/09
-- (commit 4e63731). Cette colonne est le levier qui manquait.
--
-- CE QU'ELLE PERMET. Incrémenter `token_version` invalide d'un coup TOUS les
-- jetons déjà émis pour ce marchand, sans toucher à `actif` : c'est le cas
-- « tablette perdue ou volée chez un marchand qui reste actif ». Le cas
-- « marchand suspendu » reste porté par `actif`, relu par le même cache.
--
-- AUCUNE RECONNEXION FORCÉE — c'est la règle absolue de ce chantier.
-- Le DEFAULT 1 est ce qui la garantit : les jetons déjà en circulation ne
-- portent pas de champ `tv`, et le code traite un `tv` absent comme valant 1.
-- Ils restent donc valides après le déploiement. Un jeton n'est refusé que si
-- son `tv` DIFFÈRE de la valeur en base, ce qui n'arrive qu'après une action
-- explicite de l'admin.
--
-- NOT NULL + DEFAULT 1 : aucune ligne ne peut porter NULL, donc la comparaison
-- `tv !== token_version` ne peut jamais être faussée par un NULL (en JS,
-- `1 !== null` est vrai → tous les jetons seraient refusés).
--
-- Sur 45 lignes, l'ALTER est instantané. PostgreSQL 11+ n'effectue PAS de
-- réécriture de table pour un ADD COLUMN avec DEFAULT constant.
--
-- AUCUN GRANT nécessaire : colonne ajoutée à une table existante, les droits de
-- service_role sur `marchands` sont inchangés.
--
-- À exécuter dans Supabase AVANT de déployer le code. Créer la colonne alors
-- que personne ne la lit est sans effet. Rejouable (IF NOT EXISTS).

BEGIN;
SET lock_timeout = '3s';

ALTER TABLE public.marchands
  ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.marchands.token_version IS
  'Révocation des jetons. Incrémenter invalide tous les jetons émis pour ce marchand (dashboard ET caisses). Un jeton sans champ tv vaut tv = 1.';

COMMIT;

-- ── VÉRIFICATION (à coller juste après) ──────────────────────────────────
-- Les trois colonnes doivent valoir true, et token_version = 1 partout.
--
-- SELECT
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='marchands'
--       AND column_name='token_version'
--       AND is_nullable='NO' AND column_default='1') = 1  AS colonne_ok,
--   (SELECT count(*) FROM public.marchands WHERE token_version IS NULL) = 0 AS aucun_null,
--   (SELECT count(*) FROM public.marchands WHERE token_version <> 1) = 0    AS tous_a_1,
--   (SELECT count(*) FROM public.marchands)                                 AS nb_marchands;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- À n'exécuter QU'APRÈS avoir remis le code en arrière (sinon le code lit une
-- colonne absente et refuse tous les jetons). Aucune donnée perdue : la colonne
-- ne porte que des compteurs de révocation.
--
-- BEGIN;
-- SET lock_timeout = '3s';
-- ALTER TABLE public.marchands DROP COLUMN IF EXISTS token_version;
-- COMMIT;
