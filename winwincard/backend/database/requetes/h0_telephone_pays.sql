-- H0 : téléphone selon le pays du marchand (migration 074) — requêtes en LECTURE SEULE
-- À coller dans l'éditeur SQL de Supabase, un bloc à la fois. Aucune ne montre un
-- numéro : des comptes seulement. Les blocs A et B tournent AVANT la migration (la
-- règle française y est recopiée en ligne) comme après ; le bloc C, APRÈS.
-- Le filet (`npm test`, section 31) les exécute en lecture seule à chaque passage.

-- ═══════════════════════════════════════════════════════════════════════════
-- ═══ BLOC A — AVANT la migration : qui passe en France, et ce qui change
-- ═══════════════════════════════════════════════════════════════════════════
-- Une ligne par marchand qui a au moins un numéro. pays_prevu = ce que la 074
-- posera (langue fr → FR, sinon AE). À VALIDER avant d'exécuter la 074 :
--   - un marchand « AE » avec beaucoup de « forme_fr » est probablement français
--     (langue réglée en anglais) → le passer en FR APRÈS la 074, dans l'admin ;
--   - un marchand « FR » avec beaucoup de « lus_emirats » d'origine « + » ou
--     « 971 » est probablement aux Émirats → à signaler AVANT la 074.
-- Un marchand AE n'a, par construction, aucun changement (colonne change_si_pays_prevu = 0).
WITH c AS (
  SELECT cl.marchand_id, cl.telephone, cl.telephone_normalise, cl.telephone_source,
         CASE WHEN x.t LIKE '00%' THEN '+' || substr(x.t, 3) ELSE x.t END AS s
    FROM clients cl,
         LATERAL (SELECT regexp_replace(coalesce(cl.telephone, ''), '[[:space:]./()-]', '', 'g') AS t) x
   WHERE cl.deleted_at IS NULL AND coalesce(trim(cl.telephone), '') <> ''
), f AS (
  SELECT c.*, CASE
      WHEN s ~ '^0[1-9][0-9]{8}$'     THEN '+33' || substr(s, 2)
      WHEN s ~ '^33[1-9][0-9]{8}$'    THEN '+' || s
      WHEN s ~ '^\+330[1-9][0-9]{8}$' THEN '+33' || substr(s, 5)
      WHEN s ~ '^\+[1-9][0-9]{7,14}$' THEN s
      ELSE NULL END AS norm_fr
    FROM c
)
SELECT m.slug, m.langue,
       CASE WHEN m.langue = 'fr' THEN 'FR' ELSE 'AE' END                         AS pays_prevu,
       count(*)                                                                  AS avec_numero,
       count(*) FILTER (WHERE f.telephone_normalise IS NOT NULL)                 AS utilisables_aujourdhui,
       count(*) FILTER (WHERE f.norm_fr IS NOT NULL)                             AS utilisables_si_fr,
       count(*) FILTER (WHERE f.s ~ '^(0[1-9][0-9]{8}|\+33[0-9]{9,10}|33[1-9][0-9]{8})$') AS forme_fr,
       count(*) FILTER (WHERE f.telephone_normalise LIKE '+971%')                AS lus_emirats,
       count(*) FILTER (WHERE m.langue = 'fr' AND f.norm_fr IS DISTINCT FROM f.telephone_normalise) AS change_si_pays_prevu,
       (SELECT count(*) FROM (SELECT 1 FROM f f2 WHERE f2.marchand_id = m.id AND f2.norm_fr IS NOT NULL
                               GROUP BY f2.norm_fr HAVING count(*) > 1) d)      AS doublons_si_fr
  FROM f JOIN marchands m ON m.id = f.marchand_id
 GROUP BY m.id, m.slug, m.langue
 ORDER BY pays_prevu DESC, avec_numero DESC;
-- doublons_si_fr > 0 chez un marchand qui passe en FR : la 074 s'ARRÊTE (rien
-- changé). Régler les doublons d'abord (fiche client), puis relancer.

-- Taille de la table réécrite (moment calme ; 5,6 s mesurées pour 100 000 lignes en 068) :
SELECT count(*) AS clients FROM clients;

-- ═══════════════════════════════════════════════════════════════════════════
-- ═══ BLOC B — Couverture du téléphone chez les marchands français
-- ═══════════════════════════════════════════════════════════════════════════
-- Une ligne par marchand de langue fr. Ce que H0 répare et ce qu'il ne répare pas :
--   reparables_h0    : illisibles ou lus en +971 aujourd'hui, lisibles en français
--                      (la valeur brute est intacte) → réparés par la 074 ;
--   lus_emirats_a_tort : « 05… » national lu en +971 aujourd'hui (faux numéro) ;
--   irreparables     : illisibles même en français (tronqués, faux, national étranger) ;
--   brute_ecrasee    : brute déjà réécrite en +971… par un rattachement caisse,
--                      comptoir ou import : la saisie d'origine est perdue.
WITH c AS (
  SELECT cl.marchand_id, cl.telephone, cl.telephone_normalise, cl.telephone_source,
         CASE WHEN x.t LIKE '00%' THEN '+' || substr(x.t, 3) ELSE x.t END AS s
    FROM clients cl,
         LATERAL (SELECT regexp_replace(coalesce(cl.telephone, ''), '[[:space:]./()-]', '', 'g') AS t) x
   WHERE cl.deleted_at IS NULL
), f AS (
  SELECT c.*, CASE
      WHEN s ~ '^0[1-9][0-9]{8}$'     THEN '+33' || substr(s, 2)
      WHEN s ~ '^33[1-9][0-9]{8}$'    THEN '+' || s
      WHEN s ~ '^\+330[1-9][0-9]{8}$' THEN '+33' || substr(s, 5)
      WHEN s ~ '^\+[1-9][0-9]{7,14}$' THEN s
      ELSE NULL END AS norm_fr,
      coalesce(trim(c.telephone), '') <> '' AS a_numero
    FROM c
)
SELECT m.slug, m.forfait, m.landing_premium,
       count(*)                                                               AS cartes,
       count(*) FILTER (WHERE a_numero)                                       AS avec_numero,
       round(100.0 * count(*) FILTER (WHERE a_numero) / NULLIF(count(*), 0), 1) AS pct_avec_numero,
       count(*) FILTER (WHERE telephone_normalise IS NOT NULL
                          AND telephone_normalise NOT LIKE '+971%')           AS utilisables_aujourdhui,
       count(*) FILTER (WHERE a_numero AND telephone_normalise IS NULL)       AS illisibles_aujourdhui,
       count(*) FILTER (WHERE telephone_normalise LIKE '+9715%' AND s ~ '^05[0-9]{8}$') AS lus_emirats_a_tort,
       count(*) FILTER (WHERE a_numero AND norm_fr IS NOT NULL
                          AND norm_fr IS DISTINCT FROM telephone_normalise)   AS reparables_h0,
       count(*) FILTER (WHERE a_numero AND norm_fr IS NULL)                   AS irreparables,
       count(*) FILTER (WHERE s LIKE '+971%' AND coalesce(telephone_source, '') IN ('caisse', 'comptoir', 'import')) AS brute_ecrasee,
       count(*) FILTER (WHERE norm_fr IS NOT NULL)                            AS utilisables_apres_h0,
       round(100.0 * count(*) FILTER (WHERE norm_fr IS NOT NULL) / NULLIF(count(*), 0), 1) AS pct_cartes_trouvables_apres_h0
  FROM f JOIN marchands m ON m.id = f.marchand_id
 WHERE m.langue = 'fr'
 GROUP BY m.id, m.slug, m.forfait, m.landing_premium
 ORDER BY cartes DESC;
-- pct_cartes_trouvables_apres_h0 = plafond du taux de crédit d'un connecteur par
-- numéro (Hubrise) chez ce marchand. Sans landing premium, le numéro n'est pas
-- demandé à l'inscription : ce plafond reste bas.

-- ═══════════════════════════════════════════════════════════════════════════
-- ═══ BLOC C — APRÈS la migration : écarts (attendu : 0 | 0 sur la première ligne)
-- ═══════════════════════════════════════════════════════════════════════════
-- Première requête : la preuve « Émirats inchangés ». ecarts_ae = clients d'un
-- marchand AE dont la forme normalisée diffère de la règle 068 (normaliser_telephone,
-- non modifiée) ; pays_desaccordes = clients dont le pays n'est pas celui de leur marchand.
SELECT
  (SELECT count(*) FROM clients WHERE pays_telephone = 'AE'
      AND telephone_normalise IS DISTINCT FROM normaliser_telephone(telephone))   AS ecarts_ae,
  (SELECT count(*) FROM clients c JOIN marchands m ON m.id = c.marchand_id
    WHERE c.pays_telephone <> m.pays)                                             AS pays_desaccordes,
  (SELECT count(*) FROM clients WHERE pays_telephone = 'AE')                      AS clients_ae,
  (SELECT count(*) FROM clients WHERE pays_telephone = 'FR')                      AS clients_fr;

-- Seconde : par marchand FR, ce que la 074 a réparé et ce qui reste.
SELECT m.slug,
       count(*) FILTER (WHERE coalesce(trim(c.telephone), '') <> '')                    AS avec_numero,
       count(*) FILTER (WHERE c.telephone_normalise IS NOT NULL)                        AS utilisables,
       count(*) FILTER (WHERE c.telephone_normalise IS DISTINCT FROM normaliser_telephone(c.telephone)) AS changes_par_h0,
       count(*) FILTER (WHERE coalesce(trim(c.telephone), '') <> '' AND c.telephone_normalise IS NULL) AS illisibles_restants,
       count(*) FILTER (WHERE c.telephone_normalise LIKE '+971%')                      AS encore_en_emirats
  FROM clients c JOIN marchands m ON m.id = c.marchand_id
 WHERE m.pays = 'FR' AND c.deleted_at IS NULL
 GROUP BY m.id, m.slug
 ORDER BY avec_numero DESC;
-- encore_en_emirats chez un marchand FR : soit un vrai numéro des Émirats saisi
-- avec « +971 » (juste), soit une brute écrasée par un rattachement (bloc B,
-- brute_ecrasee) : non réparable par la base, à corriger à la main si besoin.
