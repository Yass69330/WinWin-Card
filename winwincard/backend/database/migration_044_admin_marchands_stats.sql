-- Migration 044 : agrégation des compteurs de la liste admin
--
-- LECTURE SEULE. Même motif que la migration 036 (group_stats), pour la même
-- raison : PostgREST tronque toute lecture de lignes à 1 000, et
-- `GET /api/admin/marchands` comptait ses clients EN JAVASCRIPT à partir des
-- lignes ramenées. Passé 1 000 clients au total, la requête en renvoyait 1 000
-- sans erreur ni avertissement, et les marchands dont les lignes tombaient
-- au-delà du plafond affichaient 0.
--
-- Constaté en production : 1 329 clients réels, un marchand récent (Hilal
-- Kebab, 22 porteurs) affiché à 0. Le total global de l'admin, lui, était juste
-- — il vient d'un `count: 'exact'`, qui ne renvoie aucune ligne et échappe donc
-- au plafond. C'est cet écart entre les deux chiffres qui a révélé le défaut.
--
-- Conditions reprises de la migration 036, à l'identique :
--   1. UNE SEULE SIGNATURE, définitive : admin_marchands_stats() RETURNS jsonb.
--      AUCUN argument, et toute métrique future vit DANS le json, jamais dans
--      la signature → aucune variante de longueur ne sera jamais créée (piège
--      de juillet : increment_stored_value et ses 3 surcharges).
--   2. Ne touche à RIEN d'autre. CREATE OR REPLACE d'une fonction NEUVE.
--   3. L'appel exact à tester en SQL Editor avant branchement du code :
--        SELECT public.admin_marchands_stats();
--
-- STABLE : lit la base, n'écrit rien. Aucun effet sur soldes, scans ou passes.
--
-- LES TROIS FILTRES SONT REPRIS AU MOT PRÈS de ce que faisait le JS. Ils sont
-- listés comme « ne pas en oublier » au §13 de la passation :
--   clients          : deleted_at IS NULL
--   scans            : annule_le IS NULL  ET  jour courant
--   points_de_vente  : deleted_at IS NULL   (base de facturation)
--
-- LA BORNE DU JOUR. `date_scan` est un timestamptz. Le JS envoyait
-- `gte('date_scan', new Date().toISOString().split('T')[0])`, donc MINUIT UTC
-- du jour courant. On reproduit exactement cela, sans dépendre du fuseau de la
-- session :
--     date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
-- Ce choix est peut-être faux pour Dubaï, mais c'est la dette d'horloge #11 de
-- la passation, qui prescrit de la corriger AVEC le listing, jamais séparément.
-- Cette migration ne la touche pas : elle reproduit, elle ne réforme pas.
--
-- Index déjà en place, aucun à créer : idx_clients_marchand (schema.sql),
-- idx_scans_marchand_date (migration 037), points_de_vente (volume négligeable).
--
-- À exécuter dans Supabase AVANT de déployer le code qui l'appelle. Créer la
-- fonction alors que personne ne l'appelle encore est sans effet ; déployer le
-- code avant la fonction casserait la liste admin. Rejouable (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.admin_marchands_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
WITH cl AS (
  SELECT marchand_id, count(*) AS n
    FROM public.clients
   WHERE deleted_at IS NULL
   GROUP BY marchand_id
), sc AS (
  SELECT marchand_id, count(*) AS n
    FROM public.scans
   WHERE annule_le IS NULL
     AND date_scan >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
   GROUP BY marchand_id
), pv AS (
  SELECT marchand_id, count(*) AS n
    FROM public.points_de_vente
   WHERE deleted_at IS NULL
   GROUP BY marchand_id
)
SELECT COALESCE(
  jsonb_object_agg(m.id::text, jsonb_build_object(
    'total_clients',     COALESCE(cl.n, 0),
    'scans_aujourdhui',  COALESCE(sc.n, 0),
    'boutiques_actives', COALESCE(pv.n, 0)
  )),
  '{}'::jsonb
)
  FROM public.marchands m
  LEFT JOIN cl ON cl.marchand_id = m.id
  LEFT JOIN sc ON sc.marchand_id = m.id
  LEFT JOIN pv ON pv.marchand_id = m.id;
$$;

GRANT EXECUTE ON FUNCTION public.admin_marchands_stats() TO service_role;
