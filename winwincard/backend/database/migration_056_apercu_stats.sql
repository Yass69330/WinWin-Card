-- Migration 056 : Aperçu du dashboard calculé en base (étape 26)
--
-- POURQUOI. L'Aperçu lisait une liste de scans par l'API de données, coupée à
-- 1 000 lignes, et calculait en JS : « actifs 30 j », « rétention » et « visites
-- moyennes » devenaient faux au-delà de ≈ 33 scans par jour. La rétention divisait
-- par toute la base, et une base jeune ou ancienne la faussait. Dans l'onglet
-- Réseau, « vs mois préc. » comparait un mois entamé à un mois complet (toute
-- boutique stable paraissait en baisse), et la répartition des passages ne
-- comptait que depuis le 1er. Diagnostic : PASSATION §15 septtricies.
--
-- DÉCISIONS DE YASS (13/10) :
--   - rétention = clients revenus (≥ 2 passages en 30 j) parmi les clients
--     inscrits depuis au moins 30 jours, ÷ ces clients. NULL (rien affiché) tant
--     qu'aucun client n'a 30 jours ;
--   - répartition des passages : sur 30 jours glissants ;
--   - « nouveaux ce mois » et « vs mois préc. » par boutique : comparés aux MÊMES
--     JOURS du mois précédent, c'est-à-dire [1er du mois précédent, + temps écoulé
--     depuis le 1er de ce mois), borné à la fin du mois précédent ;
--   - taux de retour : calcul inchangé ;
--   - tout en UTC (sujet clos).
--
-- CE QUE FAIT LA MIGRATION.
--   - `apercu_stats(marchand, maintenant)` : un jsonb, le même pour une
--     mono-boutique et pour un réseau, sans rien par boutique. `p_maintenant` ne
--     sert qu'aux tests (horloge figée) ; le serveur ne le passe pas. Toutes les
--     lectures sont bornées à `p_maintenant` (sans effet quand il vaut now()).
--   - `group_stats` (même signature) prend son bloc « réseau » et sa répartition
--     DANS `apercu_stats` : l'Aperçu et l'onglet Réseau affichent les mêmes
--     chiffres par construction. Elle ajoute la mobilité, les boutiques et les
--     scans non attribués. Mêmes clés qu'avant : l'écran d'avant marche toujours.
--   - Les deux fonctions sont en UTC quel que soit le fuseau de la session
--     (SET timezone).
--   - `group_stats` n'est plus exécutable par PUBLIC, anon, authenticated (seul le
--     serveur l'appelle, avec service_role).
--
-- COÛT. Lecture seule, à la demande (ouverture de l'onglet). Index existants :
-- `idx_scans_marchand_date`, `idx_clients_marchand`. Mesuré au banc local :
-- 28 à 32 ms à 5 000 porteurs, 112 à 163 ms à 50 000 (§15 septtricies).
--
-- À exécuter dans Supabase AVANT de déployer le code de l'étape 26. Sans elle,
-- l'Aperçu du nouveau code répond 503 (fonction absente). Rejouable.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── apercu_stats ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apercu_stats(p_marchand_id uuid, p_maintenant timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
SET timezone = 'UTC'
AS $$
WITH bornes AS (
  SELECT p_maintenant                                            AS maintenant,
         date_trunc('day', p_maintenant)                         AS jour,
         date_trunc('month', p_maintenant)                       AS mois,
         date_trunc('month', p_maintenant) - interval '1 month'  AS prec,
         p_maintenant - interval '30 days'                       AS j30
),
b AS (
  -- Mêmes jours du mois précédent : même durée écoulée, jamais au-delà du 1er.
  SELECT bornes.*, LEAST(prec + (maintenant - mois), mois) AS prec_memes_jours FROM bornes
),
seuils AS (
  SELECT COALESCE(freq_seuil_bas, 5) AS bas, COALESCE(freq_seuil_haut, 10) AS haut
    FROM marchands WHERE id = p_marchand_id
),
s30 AS MATERIALIZED (
  SELECT sc.client_id, count(*) AS n
    FROM scans sc, b
   WHERE sc.marchand_id = p_marchand_id AND sc.annule_le IS NULL AND sc.date_scan >= b.j30 AND sc.date_scan <= b.maintenant
   GROUP BY sc.client_id
),
cl AS (
  SELECT count(*)                                                                 AS porteurs,
         count(*) FILTER (WHERE c.created_at <  b.j30)                            AS anciens,
         count(*) FILTER (WHERE c.created_at >= b.mois)                           AS nouveaux,
         count(*) FILTER (WHERE c.created_at >= b.prec AND c.created_at < b.prec_memes_jours) AS nouveaux_prec
    FROM clients c, b
   WHERE c.marchand_id = p_marchand_id AND c.deleted_at IS NULL AND c.created_at <= b.maintenant
),
act AS (
  SELECT count(*)                       AS actifs,
         COALESCE(sum(s.n), 0)          AS scans30,
         count(*) FILTER (WHERE s.n >= 2 AND c.deleted_at IS NULL AND c.created_at < (SELECT j30 FROM b)) AS revenus_anciens,
         count(*) FILTER (WHERE s.n <  (SELECT bas  FROM seuils))                                         AS d_bas,
         count(*) FILTER (WHERE s.n >= (SELECT bas  FROM seuils) AND s.n <= (SELECT haut FROM seuils))    AS d_milieu,
         count(*) FILTER (WHERE s.n >  (SELECT haut FROM seuils))                                         AS d_haut
    FROM s30 s LEFT JOIN clients c ON c.id = s.client_id
),
auj AS (
  SELECT count(*) AS n FROM scans sc, b
   WHERE sc.marchand_id = p_marchand_id AND sc.annule_le IS NULL AND sc.date_scan >= b.jour AND sc.date_scan <= b.maintenant
),
mois_scans AS MATERIALIZED (
  SELECT DISTINCT sc.client_id, (sc.date_scan >= b.mois) AS ce_mois
    FROM scans sc, b
   WHERE sc.marchand_id = p_marchand_id AND sc.annule_le IS NULL AND sc.date_scan >= b.prec AND sc.date_scan <= b.maintenant
),
retour AS (
  -- Inchangé (décision du 13/10) : actifs du mois entamé déjà venus le mois
  -- précédent COMPLET, ÷ actifs du mois.
  SELECT count(*) AS ce_mois,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM mois_scans p WHERE p.client_id = m.client_id AND NOT p.ce_mois)) AS revenus
    FROM mois_scans m WHERE m.ce_mois
)
SELECT jsonb_build_object(
  'porteurs',                       cl.porteurs,
  'scans_aujourdhui',               auj.n,
  'actifs_30j',                     act.actifs,
  'visites_moyennes',               CASE WHEN act.actifs > 0 THEN round(act.scans30::numeric / act.actifs, 1) ELSE 0 END,
  'retention',                      CASE WHEN cl.anciens > 0 THEN round(100.0 * act.revenus_anciens / cl.anciens)::int END,
  'nouveaux_ce_mois',               cl.nouveaux,
  'nouveaux_mois_prec_memes_jours', cl.nouveaux_prec,
  'taux_retour',                    CASE WHEN retour.ce_mois > 0 THEN round(100.0 * retour.revenus / retour.ce_mois)::int ELSE 0 END,
  'distribution', jsonb_build_object(
    'seuil_bas',  (SELECT bas  FROM seuils),
    'seuil_haut', (SELECT haut FROM seuils),
    'bas',    act.d_bas,
    'milieu', act.d_milieu,
    'haut',   act.d_haut
  )
)
FROM cl, act, auj, retour;
$$;

-- ── group_stats (même signature) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.group_stats(p_marchand_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
SET timezone = 'UTC'
AS $$
WITH a AS (
  SELECT apercu_stats(p_marchand_id, now()) AS j
),
bornes AS (
  SELECT date_trunc('month', now())                     AS mois_debut,
         date_trunc('month', now()) - interval '1 month' AS mois_prec_debut,
         now() - interval '90 days'                      AS j90
),
b AS (
  SELECT bornes.*, LEAST(mois_prec_debut + (now() - mois_debut), mois_debut) AS prec_memes_jours FROM bornes
),
s AS MATERIALIZED (
  SELECT sc.client_id, sc.point_de_vente_id, sc.recompense_distribuee, sc.date_scan
    FROM scans sc, b
   WHERE sc.marchand_id = p_marchand_id AND sc.date_scan >= b.j90 AND sc.annule_le IS NULL
),
mobilite AS (
  SELECT count(*) AS n FROM (
    SELECT client_id FROM s WHERE point_de_vente_id IS NOT NULL
    GROUP BY client_id HAVING count(DISTINCT point_de_vente_id) > 1
  ) m
),
scans_par_boutique AS (
  SELECT point_de_vente_id,
    count(*) FILTER (WHERE date_scan >= (SELECT mois_debut FROM b))                                                             AS scans_mois,
    -- Mêmes jours du mois précédent (décision du 13/10).
    count(*) FILTER (WHERE date_scan >= (SELECT mois_prec_debut FROM b) AND date_scan < (SELECT prec_memes_jours FROM b))       AS scans_prec,
    count(DISTINCT client_id) FILTER (WHERE date_scan >= (SELECT mois_debut FROM b))                                            AS clients_distincts,
    count(*) FILTER (WHERE recompense_distribuee IS TRUE AND date_scan >= (SELECT mois_debut FROM b))                           AS recompenses
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
  SELECT count(*) AS n FROM s, b WHERE s.point_de_vente_id IS NULL AND s.date_scan >= b.mois_debut
)
SELECT jsonb_build_object(
  'apercu', a.j,
  'reseau', jsonb_build_object(
    'porteurs',           a.j -> 'porteurs',
    'actifs_30j',         a.j -> 'actifs_30j',
    'nouveaux_ce_mois',   a.j -> 'nouveaux_ce_mois',
    'taux_retour_reseau', a.j -> 'taux_retour',
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
    WHERE NOT archivee OR scans_mois > 0 OR scans_prec > 0
  ), '[]'::jsonb),
  'scans_non_attribues', (SELECT n FROM non_attribues),
  'distribution', a.j -> 'distribution'
)
FROM a;
$$;

REVOKE ALL ON FUNCTION public.apercu_stats(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apercu_stats(uuid, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.group_stats(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.group_stats(uuid) TO service_role;

COMMIT;

-- ── VÉRIFICATION (à coller juste après) ──────────────────────────────────
-- Les quatre colonnes doivent valoir true.
--
-- SELECT
--   has_function_privilege('service_role', 'public.apercu_stats(uuid,timestamptz)', 'EXECUTE')     AS apercu_serveur_ok,
--   NOT has_function_privilege('anon', 'public.apercu_stats(uuid,timestamptz)', 'EXECUTE')         AS apercu_ferme_ok,
--   has_function_privilege('service_role', 'public.group_stats(uuid)', 'EXECUTE')
--     AND NOT has_function_privilege('anon', 'public.group_stats(uuid)', 'EXECUTE')                AS group_stats_ok,
--   (SELECT public.group_stats(id) ? 'apercu' FROM public.marchands LIMIT 1)                       AS reseau_branche_ok;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- À n'exécuter QU'APRÈS avoir remis le code en arrière : rejouer
-- migration_039_group_stats_exclut_annules.sql (group_stats d'avant), puis
--
-- DROP FUNCTION IF EXISTS public.apercu_stats(uuid, timestamptz);
