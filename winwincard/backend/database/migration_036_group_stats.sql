-- Migration 036 : fonction d'agrégation du dashboard groupe (étape 4)
--
-- LECTURE SEULE. Fait le GROUP BY côté Postgres et renvoie un petit jsonb —
-- contourne la troncature PostgREST à 1 000 lignes qui fausserait les chiffres
-- d'un réseau. C'est l'option correcte À TOUTE ÉCHELLE et la plus légère au
-- runtime (Postgres agrège, renvoie ~20 lignes, pas 20 000).
--
-- Conditions gravées avec le fondateur :
--   1. UNE SEULE SIGNATURE, définitive : group_stats(uuid) RETURNS jsonb. Toute
--      métrique future vit DANS le json, jamais dans la signature → aucune
--      variante de longueur différente ne sera jamais créée (piège de juillet).
--   2. Ne touche à RIEN d'autre. CREATE OR REPLACE d'une fonction NEUVE ; aucune
--      fonction existante modifiée, en particulier increment_stored_value.
--   3. L'appel exact à tester en SQL Editor avant branchement du code :
--        SELECT public.group_stats('<un_marchand_id>');
--
-- STABLE : lit la base, n'écrit rien, aucun effet sur soldes/scans/passes.
-- Fenêtres : mois en cours vs mois précédent (calendaires), 30 j (actifs),
-- 90 j (mobilité). Seuils de distribution lus sur marchands (migration 035).
--
-- À exécuter dans Supabase APRÈS 035. Rejouable (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.group_stats(p_marchand_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
WITH bornes AS (
  SELECT date_trunc('month', now())                     AS mois_debut,
         date_trunc('month', now()) - interval '1 month' AS mois_prec_debut,
         now() - interval '30 days'                      AS j30,
         now() - interval '90 days'                      AS j90
),
seuils AS (
  SELECT COALESCE(freq_seuil_bas, 5) AS bas, COALESCE(freq_seuil_haut, 10) AS haut
  FROM marchands WHERE id = p_marchand_id
),
-- Une seule lecture des scans sur 90 j (fenêtre max), matérialisée une fois.
s AS MATERIALIZED (
  SELECT sc.client_id, sc.point_de_vente_id, sc.recompense_distribuee, sc.date_scan
  FROM scans sc, bornes b
  WHERE sc.marchand_id = p_marchand_id AND sc.date_scan >= b.j90
),
porteurs AS (
  SELECT count(*) AS n FROM clients WHERE marchand_id = p_marchand_id AND deleted_at IS NULL
),
nouveaux AS (
  SELECT count(*) AS n FROM clients c, bornes b
  WHERE c.marchand_id = p_marchand_id AND c.deleted_at IS NULL AND c.created_at >= b.mois_debut
),
actifs30 AS (
  SELECT count(DISTINCT client_id) AS n FROM s, bornes b WHERE s.date_scan >= b.j30
),
actifs_mois AS (
  SELECT DISTINCT client_id FROM s, bornes b WHERE s.date_scan >= b.mois_debut
),
actifs_prec AS (
  SELECT DISTINCT client_id FROM s, bornes b
  WHERE s.date_scan >= b.mois_prec_debut AND s.date_scan < b.mois_debut
),
retour AS (
  SELECT (SELECT count(*) FROM actifs_mois) AS ce_mois,
         (SELECT count(*) FROM actifs_mois a WHERE a.client_id IN (SELECT client_id FROM actifs_prec)) AS revenus
),
mobilite AS (
  SELECT count(*) AS n FROM (
    SELECT client_id FROM s WHERE point_de_vente_id IS NOT NULL
    GROUP BY client_id HAVING count(DISTINCT point_de_vente_id) > 1
  ) m
),
scans_par_boutique AS (
  SELECT point_de_vente_id,
    count(*) FILTER (WHERE date_scan >= (SELECT mois_debut FROM bornes))                                                          AS scans_mois,
    count(*) FILTER (WHERE date_scan >= (SELECT mois_prec_debut FROM bornes) AND date_scan < (SELECT mois_debut FROM bornes))     AS scans_prec,
    count(DISTINCT client_id) FILTER (WHERE date_scan >= (SELECT mois_debut FROM bornes))                                         AS clients_distincts,
    count(*) FILTER (WHERE recompense_distribuee IS TRUE AND date_scan >= (SELECT mois_debut FROM bornes))                        AS recompenses
  FROM s WHERE point_de_vente_id IS NOT NULL
  GROUP BY point_de_vente_id
),
boutiques AS (
  SELECT pdv.id, pdv.nom, pdv.actif, (pdv.deleted_at IS NOT NULL) AS archivee,
    COALESCE(spb.scans_mois, 0)        AS scans_mois,
    COALESCE(spb.scans_prec, 0)        AS scans_prec,
    COALESCE(spb.clients_distincts, 0) AS clients_distincts,
    COALESCE(spb.recompenses, 0)       AS recompenses
  FROM points_de_vente pdv
  LEFT JOIN scans_par_boutique spb ON spb.point_de_vente_id = pdv.id
  WHERE pdv.marchand_id = p_marchand_id
),
non_attribues AS (
  SELECT count(*) AS n FROM s, bornes b WHERE s.point_de_vente_id IS NULL AND s.date_scan >= b.mois_debut
),
passages AS (
  SELECT client_id, count(*) AS n FROM s, bornes b WHERE s.date_scan >= b.mois_debut GROUP BY client_id
),
distrib AS (
  SELECT
    count(*) FILTER (WHERE n <  (SELECT bas  FROM seuils))                                       AS bas,
    count(*) FILTER (WHERE n >= (SELECT bas  FROM seuils) AND n <= (SELECT haut FROM seuils))    AS milieu,
    count(*) FILTER (WHERE n >  (SELECT haut FROM seuils))                                       AS haut
  FROM passages
)
SELECT jsonb_build_object(
  'reseau', jsonb_build_object(
    'porteurs',           (SELECT n FROM porteurs),
    'actifs_30j',         (SELECT n FROM actifs30),
    'nouveaux_ce_mois',   (SELECT n FROM nouveaux),
    'taux_retour_reseau', CASE WHEN (SELECT ce_mois FROM retour) > 0
                               THEN round(100.0 * (SELECT revenus FROM retour) / (SELECT ce_mois FROM retour))
                               ELSE 0 END,
    'mobilite',           (SELECT n FROM mobilite)
  ),
  'boutiques', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'nom', nom, 'actif', actif, 'archivee', archivee,
      'scans', scans_mois, 'scans_prec', scans_prec,
      'evolution_pct', CASE WHEN scans_prec > 0 THEN round(100.0 * (scans_mois - scans_prec) / scans_prec) ELSE NULL END,
      'clients_distincts', clients_distincts,
      'recompenses', recompenses
    ) ORDER BY scans_mois DESC)
    FROM boutiques
  ), '[]'::jsonb),
  'scans_non_attribues', (SELECT n FROM non_attribues),
  'distribution', jsonb_build_object(
    'seuil_bas',  (SELECT bas  FROM seuils),
    'seuil_haut', (SELECT haut FROM seuils),
    'bas',    COALESCE((SELECT bas    FROM distrib), 0),
    'milieu', COALESCE((SELECT milieu FROM distrib), 0),
    'haut',   COALESCE((SELECT haut   FROM distrib), 0)
  )
);
$$;

GRANT EXECUTE ON FUNCTION public.group_stats(uuid) TO service_role;
