-- Étape 17a — compteurs par adresse : quelle charge un même point d'accès verrait-il ?
-- Lecture seule, UNE requête, à lancer à la main dans l'éditeur SQL Supabase de la PRODUCTION.
--
-- Avec la vraie adresse du client (trust proxy 2), les clients d'une même boutique (Wi-Fi)
-- ou d'un même opérateur (4G) partagent un compteur. Deux limites sont en jeu :
--   * inscription : 20 par heure et par adresse (rateLimiters.js:4) ;
--   * global      : 300 requêtes par 15 min et par adresse (index.js).
--
-- Ce que la requête mesure, sur les 30 derniers jours, glissant (pas par heure pleine) :
--   inscriptions_1h : le plus grand nombre de NOUVELLES CARTES créées en 1 heure par un même
--                     marchand. La table clients n'a PAS de colonne boutique : « une même
--                     boutique » est approchée par « un même marchand » (maximum de la
--                     boutique <= maximum du marchand). Les cartes effacées (RGPD) comptent.
--   scans_15min     : le plus grand nombre de SCANS en 15 min par boutique (point de vente ;
--                     NULL = marchand mono-site). Chaque scan est une requête de la caisse,
--                     sur le même Wi-Fi que les clients : c'est la part CERTAINE du compteur
--                     global ; pages, cartes iPhone et inscriptions s'y ajoutent, non mesurées.
--
-- À lire : inscriptions_1h contre 20 ; scans_15min contre 300 (marge à garder pour les
-- autres requêtes : alerte à partir de 100 scans en 15 min).
WITH ins AS (
  SELECT marchand_id, NULL::uuid AS point_de_vente_id,
         count(*) OVER (PARTITION BY marchand_id ORDER BY created_at
                        RANGE BETWEEN interval '1 hour' PRECEDING AND CURRENT ROW) AS n
    FROM clients
   WHERE created_at >= now() - interval '30 days'
), sc AS (
  SELECT marchand_id, point_de_vente_id,
         count(*) OVER (PARTITION BY marchand_id, point_de_vente_id ORDER BY date_scan
                        RANGE BETWEEN interval '15 minutes' PRECEDING AND CURRENT ROW) AS n
    FROM scans
   WHERE date_scan >= now() - interval '30 days'
), mesures AS (
  SELECT 'inscriptions_1h (limite 20)' AS mesure, marchand_id, point_de_vente_id, max(n) AS maximum FROM ins GROUP BY 1, 2, 3
  UNION ALL
  SELECT 'scans_15min (limite 300, tout compris)', marchand_id, point_de_vente_id, max(n) FROM sc GROUP BY 1, 2, 3
), classees AS (
  SELECT *, row_number() OVER (PARTITION BY mesure ORDER BY maximum DESC) AS rang FROM mesures
)
SELECT c.mesure, m.nom AS marchand, pv.nom AS boutique, c.maximum
  FROM classees c
  JOIN marchands m ON m.id = c.marchand_id
  LEFT JOIN points_de_vente pv ON pv.id = c.point_de_vente_id
 WHERE c.rang <= 5
 ORDER BY c.mesure, c.maximum DESC;
