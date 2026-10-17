-- t43 : WAM scanne-t-il avec la clé d'idempotence ? (requête D filtrée sur un marchand)
-- LECTURE SEULE. À lancer dans Supabase (production) après le passage de Yass
-- chez WAM (écran rechargé + scan de test).
--
-- 1) Trouver l'identifiant de WAM (une ligne attendue) :
--      SELECT id, nom, slug FROM marchands WHERE nom ILIKE '%wam%';
-- 2) Coller cet identifiant à la place de COLLER_ID_WAM ci-dessous, puis lancer.
--
-- À lire :
--   - dernier_scan / dernier_avec_cle : le scan de test de Yass doit être le
--     dernier, et AVEC clé (les deux dates égales) ;
--   - dernier_sans_cle : doit être antérieur au scan de test (vide si WAM n'a
--     jamais scanné sans clé sur 14 jours).
-- Condition de push t43 : WAM à jour ici ET requête D globale (§15 duovicies)
-- à 100 % le jour même.
WITH m AS (SELECT 'COLLER_ID_WAM'::uuid AS id)
SELECT CASE WHEN grouping(date_trunc('day', s.date_scan)) = 1 THEN 'TOTAL' ELSE to_char(date_trunc('day', s.date_scan), 'YYYY-MM-DD') END AS jour,
       count(*)                                                   AS scans,
       count(s.cle_idempotence)                                   AS avec_cle,
       round(100.0 * count(s.cle_idempotence) / count(*), 1)      AS pct_avec_cle,
       max(s.date_scan)                                           AS dernier_scan,
       max(s.date_scan) FILTER (WHERE s.cle_idempotence IS NOT NULL) AS dernier_avec_cle,
       max(s.date_scan) FILTER (WHERE s.cle_idempotence IS NULL)     AS dernier_sans_cle
  FROM scans s
 WHERE s.marchand_id = (SELECT id FROM m)
   AND s.date_scan >= now() - interval '14 days'
 GROUP BY ROLLUP (date_trunc('day', s.date_scan))
 ORDER BY 1 DESC;
