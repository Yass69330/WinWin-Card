-- ============================================================================
-- Audit WinWin — segment 5 : les statistiques — requêtes de mesure
-- ============================================================================
-- LECTURE SEULE. Aucune requête n'écrit, ne crée ni ne modifie quoi que ce soit.
-- À exécuter dans l'éditeur SQL Supabase, UNE requête à la fois (T1 à T4).
-- Pour chaque résultat : bouton « Copy » / export CSV, puis coller dans le fil.
--
-- Les résultats ne contiennent QUE des comptages, des pourcentages, des durées,
-- des réglages de la base, des noms de marchands et des noms de boutiques
-- (acceptés en pilotage le 27/09) : aucune donnée client, aucun numéro de
-- série, aucun texte de notification, aucun texte de requête. Ils peuvent
-- figurer tels quels dans un rapport public.
--
-- Chaque requête rend moins de 100 lignes (l'éditeur tronque au-delà sans le
-- dire) : T1 une ligne par marchand ayant au moins un client ou un scan récent
-- (45 environ) ; T2 une ligne par réseau et une par boutique affichée
-- (3 réseaux et 8 boutiques au 27/09) ; T3 une ligne par marchand ayant envoyé
-- au moins une campagne, plus un total ; T4 37 lignes.
--
-- Testées avant envoi sur une base rejouée depuis le dépôt (schema.sql +
-- migrations 002→047 + rgpd_effacement.sql, PostgreSQL 16 : 48 fichiers,
-- 0 échec), avec les GRANT service_role des 7 tables centrales (00a §5.1) et
-- pg_stat_statements actif : d'abord à vide (aucune erreur, résultats nuls),
-- puis sur un jeu fabriqué dont chaque résultat était connu d'avance (voir
-- l'en-tête de chaque requête). Pour T4, chaque lecture des écrans a été
-- rejouée sous le rôle service_role dans la forme que PostgREST lui donne
-- (code source de PostgREST, dépôt officiel, lu le 28/09), avec deux témoins
-- négatifs. Durée mesurée sur la même base avec un volume synthétique de la
-- taille de la production, puis dix fois plus (voir la fin de cet en-tête).
--
-- Conventions : heures en UTC, comme le serveur et la base. « Aujourd'hui » et
-- « ce mois » sont calculés comme le dashboard les calcule : depuis minuit UTC,
-- depuis le 1er du mois à 00:00 UTC. Une visite = un scan (décision de
-- pilotage du 27/09) : aucune requête ne regroupe des scans rapprochés.
-- « Carte iPhone » = carte dont au moins un appareil Apple est enregistré
-- aujourd'hui (device_tokens).
--
-- Durées mesurées sur la base rejouée (machine du conteneur, médianes de 3) :
-- taille de la production : T1 6 ms, T2 10 ms, T3 4 ms, T4 8 ms ; dix fois
-- plus : T1 23 ms, T2 38 ms, T3 0,19 s, T4 38 ms.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- T1 — L'aperçu du dashboard, marchand par marchand, tel qu'il est calculé
-- ----------------------------------------------------------------------------
-- Pourquoi : l'onglet Aperçu affiche cinq chiffres (merchants.js:57-83) :
--   clients au total   : clients non effacés, comptage exact (:61) ;
--   scans aujourd'hui  : scans non annulés depuis minuit UTC (:62) ;
--   actifs (30 jours)  : clients distincts des scans non annulés des 30
--                        derniers jours, lus en liste de lignes (:63, exposée
--                        au plafond de 1 000 lignes, 00b L8) ;
--   taux de rétention  : clients ayant au moins 2 de ces scans, divisé par
--                        TOUS les clients non effacés (:71-73) ;
--   visites moyennes   : ces scans divisés par les actifs (:74).
-- La requête refait exactement ces calculs, sans plafond, pour dire si l'écran
-- est juste aujourd'hui et quelle marge reste avant 1 000 lignes. Elle ne
-- recalcule rien autrement que le dashboard. Colonnes ajoutées pour lire les
-- chiffres :
--   boutiques           : boutiques non archivées (réseau si au moins 1) ;
--   base_depuis_j       : âge de la base clients, en jours depuis le premier
--                         client inscrit (effacés compris) ;
--   marge_avant_1000    : 1 000 − scans_30j ;
--   actifs_dont_effaces : actifs dont la fiche a été effacée depuis ; leurs
--                         scans restent (rgpd_effacement.sql:56-57) et le
--                         dashboard les compte.
-- Arrondis : la rétention est arrondie comme dans le navigateur (Math.round) ;
-- la fréquence est donnée au dixième ; un écart d'un dixième reste possible
-- quand la valeur tombe exactement entre deux dixièmes.
-- Attendu sur le jeu fabriqué : 3 lignes, dans l'ordre R, A, B (le marchand
-- sans client ni scan n'apparaît pas).
--   Test Réseau R  : 2 boutiques, 5 clients, base 70 j, 0 scan aujourd'hui,
--     7 scans sur 30 j, marge 993, 4 actifs dont 0 effacé, 2 retenus,
--     rétention 40 %, fréquence 1,8 ;
--   Test Tampons A : 0 boutique, 4 clients, base 200 j, 1 scan aujourd'hui,
--     7 scans, marge 993, 4 actifs dont 1 effacé, 3 retenus, rétention 75 %,
--     fréquence 1,8 ;
--   Test Points B  : 0 boutique, 2 clients, base 50 j, 0 aujourd'hui, 3 scans,
--     marge 997, 2 actifs dont 0 effacé, 1 retenu, rétention 50 %,
--     fréquence 1,5.
-- ----------------------------------------------------------------------------
WITH b AS (
  SELECT now() - interval '30 days'                                      AS j30,
         date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS minuit_utc
),
par_client AS (                    -- merchants.js:63 : scans non annulés, 30 j
  SELECT s.marchand_id, s.client_id, count(*) AS n
    FROM public.scans s, b
   WHERE s.date_scan >= b.j30 AND s.annule_le IS NULL
   GROUP BY s.marchand_id, s.client_id
),
activite AS (
  SELECT p.marchand_id,
         sum(p.n)                                          AS scans_30j,
         count(*)                                          AS actifs_30j,
         count(*) FILTER (WHERE c.deleted_at IS NOT NULL)  AS dont_effaces,
         count(*) FILTER (WHERE p.n >= 2)                  AS retenus
    FROM par_client p
    JOIN public.clients c ON c.id = p.client_id
   GROUP BY p.marchand_id
),
porteurs AS (                      -- merchants.js:61
  SELECT marchand_id,
         count(*) FILTER (WHERE deleted_at IS NULL) AS clients_total,
         min(created_at)                            AS premier_client
    FROM public.clients
   GROUP BY marchand_id
),
jour AS (                          -- merchants.js:62
  SELECT s.marchand_id, count(*) AS n
    FROM public.scans s, b
   WHERE s.date_scan >= b.minuit_utc AND s.annule_le IS NULL
   GROUP BY s.marchand_id
),
boutiques AS (
  SELECT marchand_id, count(*) AS n
    FROM public.points_de_vente
   WHERE deleted_at IS NULL
   GROUP BY marchand_id
)
SELECT m.nom                                                   AS marchand,
       m.type_programme                                        AS programme,
       coalesce(bo.n, 0)                                       AS boutiques,
       coalesce(po.clients_total, 0)                           AS clients_total,
       floor(extract(epoch FROM now() - po.premier_client) / 86400)::int AS base_depuis_j,
       coalesce(j.n, 0)                                        AS scans_aujourdhui_utc,
       coalesce(a.scans_30j, 0)                                AS scans_30j,
       1000 - coalesce(a.scans_30j, 0)                         AS marge_avant_1000,
       coalesce(a.actifs_30j, 0)                               AS actifs_30j,
       coalesce(a.dont_effaces, 0)                             AS actifs_dont_effaces,
       coalesce(a.retenus, 0)                                  AS retenus_2_scans,
       CASE WHEN coalesce(po.clients_total, 0) > 0
            THEN floor(coalesce(a.retenus, 0)::float8 / po.clients_total::float8 * 100 + 0.5)::int
            ELSE 0 END                                         AS retention_affichee_pct,
       CASE WHEN coalesce(a.actifs_30j, 0) > 0
            THEN round(a.scans_30j::numeric / a.actifs_30j, 1)
            ELSE 0 END                                         AS frequence_affichee
  FROM public.marchands m
  LEFT JOIN porteurs  po ON po.marchand_id = m.id
  LEFT JOIN activite  a  ON a.marchand_id  = m.id
  LEFT JOIN jour      j  ON j.marchand_id  = m.id
  LEFT JOIN boutiques bo ON bo.marchand_id = m.id
 WHERE coalesce(po.clients_total, 0) > 0 OR coalesce(a.scans_30j, 0) > 0
 ORDER BY coalesce(a.scans_30j, 0) DESC, coalesce(po.clients_total, 0) DESC, m.nom;


-- ----------------------------------------------------------------------------
-- T2 — L'onglet Réseau, boutique par boutique, tel qu'il est calculé
-- ----------------------------------------------------------------------------
-- Pourquoi : l'onglet Réseau affiche le résultat de la fonction group_stats
-- (migration 039), appelée par merchants.js:91. La requête l'appelle
-- exactement comme le dashboard, pour chaque réseau (au moins une boutique non
-- archivée : c'est la condition d'affichage de l'onglet, merchants.js:120-129
-- et dashboard/index.html:1092-1093), et place deux repères à côté :
--   scans_prec_meme_periode, evol_meme_periode_pct : le mois précédent compté
--     du 1er jusqu'au même instant du mois (même nombre de jours écoulés).
--     La colonne affichée, evol_affichee_pct, compare le mois en cours, entamé,
--     au mois précédent complet ;
--   repartition_30j : la répartition des passages sur 30 jours glissants. La
--     colonne affichée, repartition_mois, compte les passages depuis le 1er.
-- Lignes : une ligne « réseau » (les chiffres du haut de l'onglet), puis une
-- ligne par boutique affichée, archivées comprises si elles ont eu une activité
-- ce mois-ci ou le mois précédent, comme l'onglet. Les colonnes « réseau » sont
-- vides sur les lignes « boutique », et inversement.
--   repartition_* : « moins de bas / de bas à haut / plus de haut » passages ;
--   jours_ecoules : jours écoulés depuis le 1er du mois, 00:00 UTC ;
--   fuseau        : fuseau de cette session ; doit valoir UTC, comme les appels
--                   du serveur (00a §6.5), sinon « ce mois » diffère de l'écran.
-- Attendu sur le jeu fabriqué (exécuté le 28/09, 27,2 jours écoulés) : 4 lignes.
--   Test Réseau R, réseau : porteurs 5, actifs 4, nouveaux 1, retour 75 %,
--     mobilité 2, non attribués 2, répartition du mois 3/1/0, sur 30 j 2/2/0,
--     seuils 2–3 ;
--   Boutique 1 : scans 3, mois préc. 3, évolution affichée 0 %, même période 2,
--     évolution à période égale +50 %, clients servis 2, récompenses 1 ;
--   Boutique 2 : scans 1, mois préc. 0, évolution vide, même période 0,
--     évolution vide, clients servis 1, récompenses 0 ;
--   Boutique 3 (archivée) : scans 0, mois préc. 1, −100 %, même période 1,
--     −100 %, clients servis 0, récompenses 0.
-- ----------------------------------------------------------------------------
WITH b AS (
  SELECT date_trunc('month', now())                      AS mois_debut,
         date_trunc('month', now()) - interval '1 month' AS mois_prec_debut,
         now() - date_trunc('month', now())              AS ecoule,
         now() - interval '30 days'                      AS j30
),
reseaux AS (
  SELECT m.id, m.nom, m.freq_seuil_bas AS bas, m.freq_seuil_haut AS haut,
         public.group_stats(m.id) AS gs          -- l'appel exact du dashboard
    FROM public.marchands m
   WHERE EXISTS (SELECT 1 FROM public.points_de_vente p
                  WHERE p.marchand_id = m.id AND p.deleted_at IS NULL)
),
boutique AS (
  SELECT r.nom AS reseau, e AS bj
    FROM reseaux r, jsonb_array_elements(r.gs -> 'boutiques') e
),
meme_periode AS (
  SELECT s.point_de_vente_id, count(*) AS n
    FROM public.scans s, b
   WHERE s.annule_le IS NULL
     AND s.date_scan >= b.mois_prec_debut
     AND s.date_scan <  least(b.mois_prec_debut + b.ecoule, b.mois_debut)
     AND s.marchand_id IN (SELECT id FROM reseaux)
   GROUP BY s.point_de_vente_id
),
glissant AS (
  SELECT s.marchand_id, s.client_id, count(*) AS n
    FROM public.scans s, b
   WHERE s.annule_le IS NULL AND s.date_scan >= b.j30
     AND s.marchand_id IN (SELECT id FROM reseaux)
   GROUP BY s.marchand_id, s.client_id
),
repart30 AS (
  SELECT g.marchand_id,
         count(*) FILTER (WHERE g.n <  r.bas)                   AS bas,
         count(*) FILTER (WHERE g.n >= r.bas AND g.n <= r.haut) AS milieu,
         count(*) FILTER (WHERE g.n >  r.haut)                  AS haut
    FROM glissant g JOIN reseaux r ON r.id = g.marchand_id
   GROUP BY g.marchand_id
)
SELECT reseau, niveau, boutique, archivee, scans_mois, scans_mois_prec,
       evol_affichee_pct, scans_prec_meme_periode, evol_meme_periode_pct,
       clients_servis, recompenses, porteurs, actifs_30j, nouveaux_ce_mois,
       taux_retour_pct, mobilite, scans_non_attribues, repartition_mois,
       repartition_30j, seuils, jours_ecoules, fuseau
  FROM (
  SELECT r.nom AS reseau, 1 AS o, 'réseau' AS niveau, NULL::text AS boutique,
         NULL::text AS archivee,
         NULL::int AS scans_mois, NULL::int AS scans_mois_prec,
         NULL::int AS evol_affichee_pct, NULL::int AS scans_prec_meme_periode,
         NULL::int AS evol_meme_periode_pct, NULL::int AS clients_servis,
         NULL::int AS recompenses,
         (r.gs -> 'reseau' ->> 'porteurs')::int             AS porteurs,
         (r.gs -> 'reseau' ->> 'actifs_30j')::int           AS actifs_30j,
         (r.gs -> 'reseau' ->> 'nouveaux_ce_mois')::int     AS nouveaux_ce_mois,
         (r.gs -> 'reseau' ->> 'taux_retour_reseau')::int   AS taux_retour_pct,
         (r.gs -> 'reseau' ->> 'mobilite')::int             AS mobilite,
         (r.gs ->> 'scans_non_attribues')::int              AS scans_non_attribues,
         concat_ws('/', r.gs -> 'distribution' ->> 'bas', r.gs -> 'distribution' ->> 'milieu',
                        r.gs -> 'distribution' ->> 'haut')  AS repartition_mois,
         concat_ws('/', coalesce(rp.bas, 0), coalesce(rp.milieu, 0), coalesce(rp.haut, 0)) AS repartition_30j,
         concat(r.bas, '–', r.haut)                          AS seuils,
         round(extract(epoch FROM b.ecoule) / 86400, 1)      AS jours_ecoules,
         current_setting('TimeZone')                         AS fuseau
    FROM reseaux r CROSS JOIN b
    LEFT JOIN repart30 rp ON rp.marchand_id = r.id
  UNION ALL
  SELECT bo.reseau, 2, 'boutique', bo.bj ->> 'nom',
         CASE WHEN (bo.bj ->> 'archivee')::boolean THEN 'o' ELSE 'n' END,
         (bo.bj ->> 'scans')::int, (bo.bj ->> 'scans_prec')::int,
         (bo.bj ->> 'evolution_pct')::int,
         coalesce(mp.n, 0)::int,
         CASE WHEN coalesce(mp.n, 0) > 0
              THEN round(100.0 * ((bo.bj ->> 'scans')::int - mp.n) / mp.n)::int END,
         (bo.bj ->> 'clients_distincts')::int, (bo.bj ->> 'recompenses')::int,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
    FROM boutique bo
    LEFT JOIN meme_periode mp ON mp.point_de_vente_id = (bo.bj ->> 'id')::uuid
  ) x
 ORDER BY reseau, o, scans_mois DESC NULLS LAST, boutique;


-- ----------------------------------------------------------------------------
-- T3 — Le compte rendu des campagnes : « N/M reçues »
-- ----------------------------------------------------------------------------
-- Pourquoi : l'historique des campagnes du dashboard affiche, pour chacune,
-- « N/M reçues » (dashboard/index.html:1903-1905), avec
--   M = appareils Apple du marchand (total_apple, jetons morts compris)
--     + cartes ayant un lien Google (total_google : toutes les cartes, 00b §10) ;
--   N = poussées acceptées par Apple + messages acceptés par Google
--     (notifications.js:153-160).
-- La requête met M en regard du nombre de clients du marchand au moment de
-- chaque campagne (inscrits avant la campagne, non effacés à cette date), et,
-- depuis l'ouverture du registre des envois (25/09), dit combien des messages
-- Google acceptés visaient une carte iPhone.
-- Colonnes :
--   campagnes, sans_appareil (affichées « Aucun appareil »), derniere ;
--   total_affiche, dont_apple, dont_google : somme des M ;
--   recues_affichees  : somme des N ;
--   clients_a_la_date : somme, campagne par campagne, des clients du marchand ;
--   affiche_par_client : total_affiche / clients_a_la_date ;
--   registre, envois manuels depuis le 25/09 : apple_envois, apple_ok,
--     google_envois, google_ok, google_ok_carte_iphone (messages Google
--     acceptés sur une carte ayant au moins un appareil Apple aujourd'hui) ;
--   lots_registre, campagnes_depuis_registre : campagnes vues par le registre
--     et campagnes comptées au quota depuis son ouverture ; les deux doivent
--     être égales (un écart dirait qu'une campagne a échappé au quota).
-- Attendu sur le jeu fabriqué : 3 lignes.
--   Test Tampons A : 2 campagnes, 0 sans appareil, total 18 (7 + 11), reçues
--     16, clients 7, 2,57 par client ; registre : Apple 3 dont 2 acceptés,
--     Google 5 dont 4 acceptés, dont 2 sur une carte iPhone ; lots 1,
--     campagnes depuis le registre 1 ;
--   Test Réseau R : 1 campagne, 1 sans appareil, total 0, reçues 0, clients 5,
--     0,00 ; registre : tout à 0 ;
--   TOTAL : 3 campagnes, 1 sans appareil, total 18 (7 + 11), reçues 16,
--     clients 12, 1,50 ; Apple 3 / 2 ; Google 5 / 4 / 2 ; lots 1 ; 1.
-- ----------------------------------------------------------------------------
WITH ouverture AS (
  SELECT min(envoye_le) AS debut FROM public.notification_envois
),
camp AS (
  SELECT l.marchand_id, l.created_at, l.total_apple, l.total_google,
         l.total_apple + l.total_google     AS total_affiche,
         l.envoyes_apple + l.envoyes_google AS recues_affichees,
         (SELECT count(*) FROM public.clients c
           WHERE c.marchand_id = l.marchand_id
             AND c.created_at <= l.created_at
             AND (c.deleted_at IS NULL OR c.deleted_at > l.created_at)) AS clients_a_la_date
    FROM public.notification_logs l
),
par_marchand AS (
  SELECT marchand_id,
         count(*)                                     AS campagnes,
         count(*) FILTER (WHERE total_affiche = 0)    AS sans_appareil,
         max(created_at)                              AS derniere,
         sum(total_affiche)                           AS total_affiche,
         sum(total_apple)                             AS dont_apple,
         sum(total_google)                            AS dont_google,
         sum(recues_affichees)                        AS recues_affichees,
         sum(clients_a_la_date)                       AS clients_a_la_date,
         count(*) FILTER (WHERE created_at >= (SELECT debut FROM ouverture)) AS campagnes_depuis_registre
    FROM camp
   GROUP BY marchand_id
),
registre AS (
  SELECT e.marchand_id,
         count(*) FILTER (WHERE e.plateforme = 'apple')            AS apple_envois,
         count(*) FILTER (WHERE e.plateforme = 'apple' AND e.ok)   AS apple_ok,
         count(*) FILTER (WHERE e.plateforme = 'google')           AS google_envois,
         count(*) FILTER (WHERE e.plateforme = 'google' AND e.ok)  AS google_ok,
         count(*) FILTER (WHERE e.plateforme = 'google' AND e.ok
                            AND EXISTS (SELECT 1 FROM public.device_tokens d
                                         WHERE d.serial_number = e.serial_number)) AS google_ok_carte_iphone,
         count(DISTINCT e.lot)                                     AS lots_registre
    FROM public.notification_envois e
   WHERE e.source = 'manuel'
   GROUP BY e.marchand_id
),
lignes AS (
  SELECT m.nom AS marchand, p.campagnes, p.sans_appareil,
         to_char(p.derniere, 'YYYY-MM-DD') AS derniere,
         p.total_affiche, p.dont_apple, p.dont_google, p.recues_affichees,
         p.clients_a_la_date,
         coalesce(r.apple_envois, 0)  AS apple_envois,
         coalesce(r.apple_ok, 0)      AS apple_ok,
         coalesce(r.google_envois, 0) AS google_envois,
         coalesce(r.google_ok, 0)     AS google_ok,
         coalesce(r.google_ok_carte_iphone, 0) AS google_ok_carte_iphone,
         coalesce(r.lots_registre, 0) AS lots_registre,
         p.campagnes_depuis_registre
    FROM par_marchand p
    JOIN public.marchands m ON m.id = p.marchand_id
    LEFT JOIN registre r ON r.marchand_id = p.marchand_id
)
SELECT marchand, campagnes, sans_appareil, derniere, total_affiche, dont_apple,
       dont_google, recues_affichees, clients_a_la_date, affiche_par_client,
       apple_envois, apple_ok, google_envois, google_ok, google_ok_carte_iphone,
       lots_registre, campagnes_depuis_registre
  FROM (
  SELECT 1 AS o, marchand, campagnes, sans_appareil, derniere, total_affiche,
         dont_apple, dont_google, recues_affichees, clients_a_la_date,
         round(total_affiche::numeric / nullif(clients_a_la_date, 0), 2) AS affiche_par_client,
         apple_envois, apple_ok, google_envois, google_ok, google_ok_carte_iphone,
         lots_registre, campagnes_depuis_registre
    FROM lignes
  UNION ALL
  SELECT 2, 'TOTAL', sum(campagnes), sum(sans_appareil), max(derniere),
         sum(total_affiche), sum(dont_apple), sum(dont_google),
         sum(recues_affichees), sum(clients_a_la_date),
         round(sum(total_affiche)::numeric / nullif(sum(clients_a_la_date), 0), 2),
         sum(apple_envois), sum(apple_ok), sum(google_envois), sum(google_ok),
         sum(google_ok_carte_iphone), sum(lots_registre), sum(campagnes_depuis_registre)
    FROM lignes
  ) x
 ORDER BY o, total_affiche DESC, marchand;


-- ----------------------------------------------------------------------------
-- T4 — Durées réelles des lectures de statistiques, réglages et volumes
-- ----------------------------------------------------------------------------
-- Pourquoi : dire combien de temps la base met aujourd'hui à calculer chaque
-- chiffre affiché, pour le situer par rapport au plafond de 8 s probable
-- (00a §6.5), et donner les réglages et volumes qui permettent de chiffrer, par
-- mesure sur la base rejouée, le volume où ce plafond serait atteint.
-- Source des durées : pg_stat_statements (installé, 00a §6.3), appels du
-- serveur seulement (rôle service_role) : ce qui est lancé dans cet éditeur,
-- sous le rôle postgres, n'est pas compté, ni une lecture faite à l'intérieur
-- d'une fonction (requêtes de premier niveau seulement). Chaque requête
-- enregistrée est rangée dans une rubrique d'après les tables et les colonnes
-- qu'elle lit ; son texte n'est jamais rendu. Durées d'exécution dans la base,
-- hors réseau, cumulées depuis stats_reset.
-- Colonnes : section (durée, mesure, réglage, volume), rubrique, appels,
-- moyenne_ms et max_ms (durées), valeur (mesures, réglages, volumes).
--   « entrées illisibles pour ce rôle » : si elle n'est pas nulle, une partie
--     des requêtes n'est pas lisible depuis cet éditeur et les durées sont
--     incomplètes ;
--   une rubrique à 0 appel : écran jamais ouvert depuis stats_reset, ou forme
--     de requête différente de celle attendue (NON VÉRIFIABLE alors).
-- Attendu sur le jeu fabriqué, après rejeu de chaque écran sous service_role :
--   group_stats 2 appels ; compteurs admin par marchand 1 ; clients au total
--   3 ; scans aujourd'hui 3 ; scans des 30 jours 3 ; clients totaux 1 ; scans
--   cumulés 1 ; marchands actifs 1 ; quota 2 ; historique des campagnes 1 ;
--   liste clients 1 ; export 1 ; historique des scans 2 ; fiche client 1. La
--   lecture du cron (sans filtre d'annulation) et un appel de group_stats sous
--   postgres ne sont comptés nulle part. Volumes : 11 clients, 22 scans,
--   0,6 scan par jour, pire jour 2, plus gros réseau sur 90 jours « Test Réseau
--   R » (10), plus gros marchand sur 30 jours « Test Réseau R » (7), plus gros
--   stock de clients « Test Réseau R » (5), 3 campagnes.
-- ----------------------------------------------------------------------------
WITH regles(o, rubrique, a, b, c, d, sauf) AS (VALUES
  (1,  'réseau : group_stats (onglet Réseau)',                    '%public.group_stats(%',           '%', '%', '%', NULL),
  (2,  'admin : compteurs par marchand (admin_marchands_stats)',  '%public.admin_marchands_stats(%', '%', '%', '%', NULL),
  (3,  'aperçu : clients au total (comptage)',                    '%from public.clients%', '%count(*)%', '%public.clients.marchand_id =%', '%', NULL),
  (4,  'aperçu : scans aujourd''hui (comptage)',                  '%from public.scans%',   '%count(*)%', '%date_scan >=%', '%annule_le is null%', NULL),
  (5,  'aperçu : scans des 30 jours (liste, plafond 1 000)',      '%from public.scans%',   '%date_scan >=%', '%annule_le is null%', '%', '%count(*)%'),
  (6,  'admin : clients totaux (comptage)',                       '%from public.clients%', '%count(*)%', '%', '%', '%marchand_id =%'),
  (7,  'admin : scans cumulés (comptage)',                        '%from public.scans%',   '%count(*)%', '%', '%', '%date_scan%'),
  (8,  'admin : marchands actifs (comptage)',                     '%from public.marchands%', '%count(*)%', '%', '%', NULL),
  (9,  'notifications : quota du mois (comptage)',                '%from public.notification_logs%', '%count(*)%', '%', '%', NULL),
  (10, 'notifications : historique des campagnes (liste)',        '%from public.notification_logs%', '%order by%', '%', '%', '%count(*)%'),
  (11, 'clients : liste (plafond 1 000)',                         '%from public.clients%', '%order by public.clients.stored_value desc%', '%', '%', NULL),
  (12, 'clients : export CSV (plafond 1 000)',                    '%from public.clients%', '%order by public.clients.created_at desc%', '%public.clients.marchand_id =%', '%', NULL),
  (13, 'scans : historique (100 derniers)',                       '%from public.scans%',   '%order by public.scans.date_scan desc%', '%public.scans.marchand_id =%', '%', NULL),
  (14, 'fiche client : 10 derniers scans',                        '%from public.scans%',   '%order by public.scans.date_scan desc%', '%public.scans.client_id =%', '%', NULL)
),
st AS (
  SELECT row_number() OVER () AS k, lower(replace(q.query, '"', '')) AS t,
         q.calls, q.total_exec_time, q.max_exec_time
    FROM pg_stat_statements q
    JOIN pg_roles r ON r.oid = q.userid
   WHERE r.rolname = 'service_role'
     AND q.toplevel           -- jamais une lecture interne à une fonction
),
classe AS (
  SELECT DISTINCT ON (st.k) st.k, g.o, st.calls, st.total_exec_time, st.max_exec_time
    FROM st
    JOIN regles g
      ON st.t LIKE g.a AND st.t LIKE g.b AND st.t LIKE g.c AND st.t LIKE g.d
     AND (g.sauf IS NULL OR st.t NOT LIKE g.sauf)
   ORDER BY st.k, g.o
),
lignes AS (
  SELECT 1 AS s, g.o, 'durée' AS section, g.rubrique,
         coalesce(sum(c.calls), 0)::bigint                                     AS appels,
         round((sum(c.total_exec_time) / nullif(sum(c.calls), 0))::numeric, 1) AS moyenne_ms,
         round(max(c.max_exec_time)::numeric, 1)                               AS max_ms,
         NULL::text                                                            AS valeur
    FROM regles g LEFT JOIN classe c ON c.o = g.o
   GROUP BY g.o, g.rubrique
  UNION ALL
  SELECT 2, 1, 'mesure', 'stats_reset (début des durées)', NULL, NULL, NULL,
         (SELECT stats_reset::text FROM pg_stat_statements_info)
  UNION ALL
  SELECT 2, 2, 'mesure', 'entrées enregistrées, tous rôles', NULL, NULL, NULL,
         (SELECT count(*) FROM pg_stat_statements)::text
  UNION ALL
  SELECT 2, 3, 'mesure', 'entrées illisibles pour ce rôle', NULL, NULL, NULL,
         (SELECT count(*) FROM pg_stat_statements WHERE query = '<insufficient privilege>')::text
  UNION ALL
  SELECT 3, v.n, 'réglage', v.nom, NULL, NULL, NULL, current_setting(v.nom, true)
    FROM (VALUES (1, 'server_version'), (2, 'work_mem'), (3, 'shared_buffers'),
                 (4, 'effective_cache_size'), (5, 'max_parallel_workers_per_gather'),
                 (6, 'jit'), (7, 'random_page_cost'), (8, 'TimeZone'),
                 (9, 'pg_stat_statements.max'), (10, 'pg_stat_statements.track')) v(n, nom)
  UNION ALL
  SELECT 4, 1, 'volume', 'clients non effacés (plateforme)', NULL, NULL, NULL,
         (SELECT count(*) FROM public.clients WHERE deleted_at IS NULL)::text
  UNION ALL
  SELECT 4, 2, 'volume', 'scans non annulés, cumul (plateforme)', NULL, NULL, NULL,
         (SELECT count(*) FROM public.scans WHERE annule_le IS NULL)::text
  UNION ALL
  SELECT 4, 3, 'volume', 'scans des 30 derniers jours, moyenne par jour (plateforme)', NULL, NULL, NULL,
         (SELECT round(count(*) / 30.0, 1) FROM public.scans
           WHERE annule_le IS NULL AND date_scan >= now() - interval '30 days')::text
  UNION ALL
  SELECT 4, 4, 'volume', 'pire jour UTC des 30 derniers jours (scans, plateforme)', NULL, NULL, NULL,
         (SELECT max(n) FROM (SELECT count(*) AS n FROM public.scans
                               WHERE annule_le IS NULL AND date_scan >= now() - interval '30 days'
                               GROUP BY date_trunc('day', date_scan AT TIME ZONE 'UTC')) j)::text
  UNION ALL
  (SELECT 4, 5, 'volume', 'plus gros réseau, scans sur 90 jours : ' || m.nom, NULL, NULL, NULL,
          count(*)::text
     FROM public.scans s JOIN public.marchands m ON m.id = s.marchand_id
    WHERE s.annule_le IS NULL AND s.date_scan >= now() - interval '90 days'
      AND EXISTS (SELECT 1 FROM public.points_de_vente p
                   WHERE p.marchand_id = m.id AND p.deleted_at IS NULL)
    GROUP BY m.id, m.nom ORDER BY count(*) DESC, m.nom LIMIT 1)
  UNION ALL
  (SELECT 4, 6, 'volume', 'plus gros marchand, scans sur 30 jours : ' || m.nom, NULL, NULL, NULL,
          count(*)::text
     FROM public.scans s JOIN public.marchands m ON m.id = s.marchand_id
    WHERE s.annule_le IS NULL AND s.date_scan >= now() - interval '30 days'
    GROUP BY m.id, m.nom ORDER BY count(*) DESC, m.nom LIMIT 1)
  UNION ALL
  (SELECT 4, 7, 'volume', 'plus gros stock de clients d''un marchand : ' || m.nom, NULL, NULL, NULL,
          count(*)::text
     FROM public.clients c JOIN public.marchands m ON m.id = c.marchand_id
    WHERE c.deleted_at IS NULL
    GROUP BY m.id, m.nom ORDER BY count(*) DESC, m.nom LIMIT 1)
  UNION ALL
  SELECT 4, 8, 'volume', 'campagnes enregistrées (notification_logs)', NULL, NULL, NULL,
         (SELECT count(*) FROM public.notification_logs)::text
  UNION ALL
  SELECT 4, 9, 'volume', 'table scans, index compris (Mo)', NULL, NULL, NULL,
         round(pg_total_relation_size('public.scans') / 1048576.0, 2)::text
  UNION ALL
  SELECT 4, 10, 'volume', 'table clients, index compris (Mo)', NULL, NULL, NULL,
         round(pg_total_relation_size('public.clients') / 1048576.0, 2)::text
)
SELECT section, rubrique, appels, moyenne_ms, max_ms, valeur
  FROM lignes
 ORDER BY s, o;
