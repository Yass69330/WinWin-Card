-- ============================================================================
-- Audit WinWin — segment 0 (00b) : cartographie des liens — requêtes de mesure
-- ============================================================================
-- LECTURE SEULE. Aucune requête n'écrit, ne crée ni ne modifie quoi que ce soit.
-- À exécuter dans l'éditeur SQL Supabase, UNE requête à la fois (C1 à C8).
-- Pour chaque résultat : bouton « Copy » / export CSV, puis coller dans le fil.
-- Chaque requête rend moins de 100 lignes (l'éditeur tronque au-delà sans le dire).
--
-- Testées avant envoi sur une base rejouée depuis le dépôt (schema.sql +
-- migrations 002→047 + rgpd_effacement.sql, PostgreSQL 16 : 48 fichiers, 0 échec),
-- à vide puis avec un jeu de données fabriqué dont les résultats étaient connus
-- d'avance (1 205 clients, 1 157 scans, 1 027 exécutions, 1 052 jetons…) :
-- C1 13/13, C3 8/8, C4 4/4, C5 et C6 conformes. C7 testée sur un second jeu de
-- neuf cas choisis (scan crédité sans ligne, ajustements tracé et non tracé,
-- parrain crédité, scan annulé, mode points, clients sans scan) : 15/15.
-- C8, ajoutée le 27/09 après l'exécution de C1 à C7 : 2/2 (coupure complète ;
-- un marchand actif avec un filleul crédité, un non crédité, un supprimé).
--
-- Chaque ligne de C1 correspond à une lecture de l'inventaire F1 du rapport
-- docs/audit/00b-cartographie.md (même code L1…L13, même fichier:ligne).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- C1 — Distance au plafond de 1 000 lignes, lecture par lecture (inventaire F1)
-- Pour chaque lecture non bornée du code, la plus grande valeur actuelle, le
-- marchand qui la porte, et la marge avant 1 000. Les filtres reproduisent
-- exactement ceux du code (fichier:ligne dans la colonne `code`). Tous les
-- marchands sont mesurés, interrupteurs de workflow allumés ou non : un
-- interrupteur s'allume d'un clic dans l'admin.
-- Attendu : toutes les valeurs très en dessous de 1 000 (plus gros marchand
-- ≈ 200 clients d'après le pilotage), SAUF L9 (tous les clients de la
-- plateforme, ≈ 1 600) : déjà au-delà du plafond. 13 lignes.
-- ----------------------------------------------------------------------------
WITH m AS (
  SELECT id, nom,
         coalesce(nullif(max_value, 0), 10)                    AS seuil,
         coalesce(nullif(workflow_inactive_days, 0), 30)        AS jours_inactif,
         coalesce(nullif(workflow_near_reward_threshold, 0), 2) AS ecart_boost
    FROM public.marchands
),
l AS (
  SELECT 'L1' AS lecture, 'cron.js:52' AS code, 'scans dans la fenêtre d''inactivité' AS ramene, m.nom AS marchand,
         (SELECT count(*) FROM public.scans s
           WHERE s.marchand_id = m.id
             AND s.date_scan >= now() - make_interval(days => m.jours_inactif)) AS n
    FROM m
  UNION ALL
  SELECT 'L2', 'cron.js:53 · clients.js:100 · clients.js:123', 'clients non supprimés', m.nom,
         (SELECT count(*) FROM public.clients c
           WHERE c.marchand_id = m.id AND c.deleted_at IS NULL)
    FROM m
  UNION ALL
  SELECT 'L3', 'cron.js:54', 'relances inactif des 7 derniers jours', m.nom,
         (SELECT count(*) FROM public.workflow_executions w
           WHERE w.marchand_id = m.id AND w.workflow_type = 'inactive'
             AND w.executed_at >= now() - interval '7 days')
    FROM m
  UNION ALL
  SELECT 'L4', 'cron.js:115', 'clients proches de la récompense', m.nom,
         (SELECT count(*) FROM public.clients c
           WHERE c.marchand_id = m.id AND c.deleted_at IS NULL
             AND m.seuil - m.ecart_boost > 0            -- cron.js:112 saute sinon le marchand
             AND c.stored_value >= m.seuil - m.ecart_boost
             AND c.stored_value <  m.seuil)
    FROM m
  UNION ALL
  SELECT 'L5', 'cron.js:120', 'boosts des 7 derniers jours', m.nom,
         (SELECT count(*) FROM public.workflow_executions w
           WHERE w.marchand_id = m.id AND w.workflow_type = 'near_reward'
             AND w.executed_at >= now() - interval '7 days')
    FROM m
  UNION ALL
  SELECT 'L6', 'cron.js:190', 'clients avec date de naissance', m.nom,
         (SELECT count(*) FROM public.clients c
           WHERE c.marchand_id = m.id AND c.deleted_at IS NULL
             AND c.date_anniversaire IS NOT NULL)
    FROM m
  UNION ALL
  SELECT 'L7', 'cron.js:195', 'anniversaires envoyés depuis le 1er janvier (UTC)', m.nom,
         (SELECT count(*) FROM public.workflow_executions w
           WHERE w.marchand_id = m.id AND w.workflow_type = 'birthday'
             AND w.executed_at >= date_trunc('year', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
    FROM m
  UNION ALL
  SELECT 'L8', 'merchants.js:63', 'scans non annulés des 30 derniers jours', m.nom,
         (SELECT count(*) FROM public.scans s
           WHERE s.marchand_id = m.id AND s.annule_le IS NULL
             AND s.date_scan >= now() - interval '30 days')
    FROM m
  UNION ALL
  SELECT 'L9', 'clients.js:331', 'clients non supprimés, toute la plateforme', '(plateforme)',
         (SELECT count(*) FROM public.clients WHERE deleted_at IS NULL)
  UNION ALL
  SELECT 'L10', 'notifications.js:80', 'jetons Apple du marchand', m.nom,
         (SELECT count(*) FROM public.device_tokens d WHERE d.marchand_id = m.id)
    FROM m
  UNION ALL
  SELECT 'L11', 'notifications.js:84', 'cartes avec objet Google (google_pass_url)', m.nom,
         (SELECT count(*) FROM public.passes p
           WHERE p.marchand_id = m.id AND p.google_pass_url IS NOT NULL)
    FROM m
  UNION ALL
  SELECT 'L12', 'admin.js:38 · admin.js:652 · admin.js:696 · cron.js:32/93/165', 'marchands, toute la plateforme', '(plateforme)',
         (SELECT count(*) FROM public.marchands)
  UNION ALL
  SELECT 'L13', 'merchants.js:121 · admin.js:86', 'boutiques non archivées', m.nom,
         (SELECT count(*) FROM public.points_de_vente v
           WHERE v.marchand_id = m.id AND v.deleted_at IS NULL)
    FROM m
)
SELECT DISTINCT ON (lecture_num)
       lecture, code, ramene, marchand AS marchand_du_max, n AS valeur_max, 1000 - n AS marge_avant_1000
  FROM (SELECT l.*, substr(lecture, 2)::int AS lecture_num FROM l) x
 ORDER BY lecture_num, n DESC, marchand;


-- ----------------------------------------------------------------------------
-- C2 — Volumétrie des 14 tables (le stock partagé entre les composants)
-- Nombre exact de lignes et taille sur disque (table + index + toast).
-- Attendu : 14 lignes ; scans et notification_envois en tête ; workflows = 0
-- (table jamais lue ni écrite par le code, voir « liens morts »).
-- ----------------------------------------------------------------------------
SELECT t.tablename AS table_,
       (xpath('/row/n/text()',
              query_to_xml(format('SELECT count(*) AS n FROM public.%I', t.tablename), false, true, '')))[1]::text::bigint AS lignes,
       pg_size_pretty(pg_total_relation_size(format('public.%I', t.tablename)::regclass)) AS taille_totale
  FROM pg_tables t
 WHERE t.schemaname = 'public'
 ORDER BY lignes DESC, table_;


-- ----------------------------------------------------------------------------
-- C3 — Preuves ponctuelles : traces laissées (ou non) par les échecs muets
-- Une seule ligne. Chaque colonne teste un endroit précis de l'inventaire F3 :
--   marchands_avec_lien_avis   : interrupteur de l'avis Google (services/avis.js:90)
--   liste_liens_avis           : lesquels (Hamza Salon en avait un pour la recette du 26/09)
--   marchand_demo              : la redirection /demo → /l/demo (index.js:83) mène-t-elle quelque part ?
--   clients_sans_ligne_passes  : clients.js:53 (insert passes dont l'erreur n'est pas lue)
--   cartes_sans_lien_google    : clients.js:83 / google-wallet.js:33 (update non vérifié), ou
--                                cartes créées avant la configuration Google
--   clients_sans_consentement  : clients.js:62 (.then().catch() mort) — hors échelle (RGPD)
--   relances_doublees_meme_jour: même client, même workflow, même jour UTC, plus d'une fois
--                                (deux passages du cron, ou cron + déclenchement manuel)
-- Attendu : liens avis = 0 ou 1 ; clients_sans_ligne_passes = 0 ;
-- clients_sans_consentement = 0 ; relances_doublees_meme_jour = 0.
-- Toute valeur non nulle sur ces trois dernières colonnes prouve qu'un échec
-- muet s'est déjà produit en production.
-- ----------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM public.marchands WHERE coalesce(btrim(lien_avis_google), '') <> '')      AS marchands_avec_lien_avis,
  (SELECT string_agg(nom, ', ' ORDER BY nom) FROM public.marchands
    WHERE coalesce(btrim(lien_avis_google), '') <> '')                                            AS liste_liens_avis,
  (SELECT count(*) FROM public.marchands WHERE slug = 'demo')                                     AS marchand_demo,
  (SELECT count(*) FROM public.clients c
    WHERE c.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.passes p WHERE p.serial_number = c.pass_serial_number)) AS clients_sans_ligne_passes,
  (SELECT count(*) FROM public.passes WHERE google_pass_url IS NULL)                              AS cartes_sans_lien_google,
  (SELECT count(*) FROM public.passes)                                                            AS cartes_total,
  (SELECT count(*) FROM public.clients c
    WHERE c.deleted_at IS NULL
      AND (c.email IS NOT NULL OR c.telephone IS NOT NULL OR c.date_anniversaire IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM public.consentements k WHERE k.client_id = c.id))              AS clients_sans_consentement,
  (SELECT count(*) FROM (
     SELECT 1 FROM public.workflow_executions
      GROUP BY client_id, workflow_type, (executed_at AT TIME ZONE 'UTC')::date
     HAVING count(*) > 1) d)                                                                      AS relances_doublees_meme_jour;


-- ----------------------------------------------------------------------------
-- C4 — L'identité Apple partagée : un seul Pass Type ID pour tous les marchands
-- Combien d'appareils portent des cartes de plusieurs marchands (un push vers
-- l'un réveille la liste de toutes ses cartes), et combien de jetons push sont
-- partagés entre plusieurs cartes.
-- Attendu : une ligne ; appareils_multi_marchands ≥ 1 (au moins l'appareil de
-- test du fondateur, 12 cartes, rapport A).
-- ----------------------------------------------------------------------------
SELECT
  count(*)                                              AS appareils,
  count(*) FILTER (WHERE n_marchands > 1)               AS appareils_multi_marchands,
  max(n_cartes)                                         AS max_cartes_par_appareil,
  (SELECT count(*) FROM (SELECT push_token FROM public.device_tokens
                          GROUP BY push_token HAVING count(DISTINCT serial_number) > 1) j)
                                                        AS jetons_partages_entre_cartes
  FROM (SELECT device_id,
               count(DISTINCT serial_number) AS n_cartes,
               count(DISTINCT marchand_id)   AS n_marchands
          FROM public.device_tokens
         GROUP BY device_id) a;


-- ----------------------------------------------------------------------------
-- C5 — Le voisinage du cron et du rush : scans par heure UTC, 30 derniers jours
-- Le cron tourne à 08:00 UTC dans le process qui sert les scans (cron.js:17).
-- La langue du marchand sert d'indicateur de marché (fr = France ; en = Dubaï
-- et autres) : aucune colonne pays n'existe en base. Scans annulés compris :
-- un scan annulé a bien occupé la caisse et le serveur.
-- Attendu : au plus 48 lignes (24 heures × 2 langues). La ligne heure_utc = 8
-- dit combien de scans partagent aujourd'hui la fenêtre du cron ;
-- pire_heure_du_mois est le maximum atteint en une seule heure réelle.
-- ----------------------------------------------------------------------------
WITH h AS (
  SELECT date_trunc('hour', s.date_scan AT TIME ZONE 'UTC') AS heure,
         m.langue,
         count(*) AS n
    FROM public.scans s
    JOIN public.marchands m ON m.id = s.marchand_id
   WHERE s.date_scan >= now() - interval '30 days'
   GROUP BY 1, 2
)
SELECT extract(hour FROM heure)::int AS heure_utc,
       langue,
       sum(n)                        AS scans_30j,
       round(sum(n) / 30.0, 1)       AS scans_par_jour_moyen,
       max(n)                        AS pire_heure_du_mois
  FROM h
 GROUP BY 1, 2
 ORDER BY 1, 2;


-- ----------------------------------------------------------------------------
-- C6 — Durée réelle du passage du cron, mesurée par le registre des envois
-- Le cron démarre à 08:00 UTC (cron.js:17) et écrit une ligne de registre par
-- envoi, en un lot par marchand et par workflow, APRÈS les envois de ce
-- marchand (notif-registre.js). L'heure du dernier lot donne donc la durée du
-- passage, à la purge finale près. Registre disponible depuis le 25/09 : rien
-- avant. Un jour sans aucun envoi automatique n'apparaît pas.
-- Attendu : au plus 10 lignes ; cartes_notifiees de l'ordre de quelques
-- dizaines ; fin_du_dernier_lot quelques secondes à quelques minutes après 08:00.
-- ----------------------------------------------------------------------------
SELECT (envoye_le AT TIME ZONE 'UTC')::date                         AS jour,
       count(*)                                                     AS lignes_registre,
       count(DISTINCT lot)                                          AS lots,
       count(DISTINCT serial_number)                                AS cartes_notifiees,
       min(envoye_le AT TIME ZONE 'UTC')::time(0)                   AS premier_lot_ecrit,
       max(envoye_le AT TIME ZONE 'UTC')::time(0)                   AS fin_du_dernier_lot,
       date_trunc('second', max(envoye_le) - (date_trunc('day', max(envoye_le) AT TIME ZONE 'UTC') + interval '8 hours') AT TIME ZONE 'UTC')
                                                                    AS duree_depuis_0800
  FROM public.notification_envois
 WHERE source IN ('inactive', 'near_reward', 'birthday')
 GROUP BY 1
 ORDER BY 1 DESC
 LIMIT 10;


-- ----------------------------------------------------------------------------
-- C7 — Soldes qui ont bougé sans ligne de scan (gravité 1, scan.js:169-183)
-- Le scan crédite le solde (increment_stored_value) PUIS écrit la ligne de
-- scans sans lire son erreur : un échec laisse un solde crédité sans ligne.
-- Une seule ligne de résultat, en trois blocs :
--  (a) DEPUIS LE REGISTRE (25/09) — preuve directe. Chaque scan écrit, après la
--      réponse et même si la ligne de scans a échoué, un lot Google de source
--      'scan' dans notification_envois (scan.js:260-280). Une carte qui a PLUS
--      de lots 'scan' que de lignes de scans + crédits de parrainage reçus
--      (le push au parrain utilise aussi la source 'scan', scan.js:342-348)
--      porte un scan crédité sans ligne.
--  (b) TOUT L'HISTORIQUE — borne haute. Solde actuel comparé à la somme des
--      variations (après − avant) des scans non annulés : un écart vient d'un
--      ajustement manuel du dashboard, d'un crédit de parrainage, d'une
--      correction SQL… ou d'une ligne de scan manquante. Avant le 25/09, un
--      ajustement manuel ne laisse AUCUNE trace : l'écart ne se ventile pas.
--  (c) EXPOSITION d'un second défaut de gravité 1 : credit_referral plafonne le
--      solde du parrain à max_value (migration_015:33) ; en mode points, un
--      parrain au-dessus du seuil y perd son surplus.
-- Attendu : evenements_scan_sans_ligne = 0 ; (b) à lire avec Yass (ajustements
-- manuels connus) ; (c) nombre de marchands en points avec parrainage actif.
-- ----------------------------------------------------------------------------
WITH t0 AS (
  SELECT min(envoye_le) AS t0 FROM public.notification_envois
),
ev AS (                                -- (a) événements de scan vus par le registre
  SELECT e.serial_number, count(DISTINCT e.lot) AS lots
    FROM public.notification_envois e
   WHERE e.source = 'scan' AND e.plateforme = 'google' AND e.serial_number IS NOT NULL
   GROUP BY e.serial_number
),
cmp AS (
  SELECT c.id, ev.lots,
         (SELECT count(*) FROM public.scans s
           WHERE s.client_id = c.id
             AND s.date_scan >= (SELECT t0 FROM t0) - interval '10 minutes')            AS lignes_scans,
         (SELECT count(*) FROM public.referral_credits r
           WHERE r.parrain_client_id = c.id
             AND r.created_at >= (SELECT t0 FROM t0) - interval '10 minutes')           AS credits_recus
    FROM ev JOIN public.clients c ON c.pass_serial_number = ev.serial_number
),
j AS (                                 -- (b) solde contre journal, client par client
  SELECT c.id, c.pass_serial_number, c.stored_value,
         coalesce(sum(s.stored_value_apres - s.stored_value_avant)
                    FILTER (WHERE s.annule_le IS NULL), 0)                              AS somme_journal,
         count(s.id) FILTER (WHERE s.annule_le IS NULL)                                 AS nb_scans
    FROM public.clients c
    LEFT JOIN public.scans s ON s.client_id = c.id
   WHERE c.deleted_at IS NULL
   GROUP BY c.id
),
e AS (
  SELECT j.*, j.stored_value - j.somme_journal AS ecart,
         EXISTS (SELECT 1 FROM public.referral_credits r WHERE r.parrain_client_id = j.id)  AS parrain_credite,
         EXISTS (SELECT 1 FROM public.notification_envois n
                  WHERE n.source = 'ajustement' AND n.serial_number = j.pass_serial_number) AS ajuste_depuis_registre
    FROM j
),
sauts AS (                             -- (b) où se situe l'écart dans le journal
  SELECT client_id, date_scan,
         stored_value_avant - coalesce(lag(stored_value_apres) OVER w, 0) AS saut
    FROM public.scans
   WHERE annule_le IS NULL
  WINDOW w AS (PARTITION BY client_id ORDER BY date_scan, id)
)
SELECT
  -- (a)
  (SELECT t0 FROM t0)::timestamp(0)                                              AS registre_depuis,
  (SELECT coalesce(sum(lots), 0) FROM cmp)                                        AS evenements_scan_registre,
  (SELECT count(*) FROM cmp WHERE lots > lignes_scans + credits_recus)            AS cartes_scan_sans_ligne,
  (SELECT coalesce(sum(lots - lignes_scans - credits_recus), 0) FROM cmp
    WHERE lots > lignes_scans + credits_recus)                                    AS evenements_scan_sans_ligne,
  -- (b)
  (SELECT count(*) FROM e)                                                        AS clients_actifs,
  (SELECT count(*) FROM e WHERE ecart <> 0)                                       AS soldes_differents_du_journal,
  (SELECT count(*) FROM e WHERE ecart <> 0 AND parrain_credite)                   AS dont_parrains_credites,
  (SELECT count(*) FROM e WHERE ecart <> 0 AND ajuste_depuis_registre)            AS dont_ajustes_depuis_registre,
  (SELECT count(*) FROM e WHERE ecart <> 0 AND NOT parrain_credite
                            AND NOT ajuste_depuis_registre)                       AS sans_explication_en_base,
  (SELECT count(*) FROM e WHERE ecart <> 0 AND nb_scans = 0)                      AS dont_sans_aucun_scan,
  (SELECT min(ecart) || ' / ' || max(ecart) FROM e
    WHERE ecart <> 0 AND NOT parrain_credite AND NOT ajuste_depuis_registre)      AS ecart_min_max_sans_explication,
  (SELECT count(*) FROM sauts WHERE saut <> 0)                                    AS ruptures_de_chaine_du_journal,
  (SELECT max(date_scan)::date FROM sauts WHERE saut <> 0)                        AS derniere_rupture,
  -- (c)
  (SELECT count(*) FROM public.marchands
    WHERE type_programme = 'points' AND referral_enabled)                         AS marchands_points_avec_parrainage,
  (SELECT count(*) FROM public.referral_credits r
     JOIN public.marchands m ON m.id = r.marchand_id
    WHERE m.type_programme = 'points')                                            AS credits_parrainage_en_mode_points;


-- ----------------------------------------------------------------------------
-- C8 — Coupure du parrainage (décision de pilotage du 27/09)
-- À exécuter une fois la coupure faite.
-- marchands_parrainage_actif : marchands dont le drapeau referral_enabled est
--   encore allumé. Attendu : 0.
-- filleuls_lies_sans_credit : clients non supprimés liés à un parrain
--   (referred_by_client_id) sans crédit versé (aucune ligne referral_credits).
--   Pas de valeur attendue : chiffre à relever pour la décision d'après
--   l'audit. La coupure n'arrête pas la liaison à l'inscription
--   (clients.js:69-72) ; si le parrainage était rallumé, chacun de ces
--   filleuls créditerait son parrain une fois, au premier scan où son solde
--   part de 0 (scan.js:196).
-- 1 ligne.
-- ----------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM public.marchands WHERE referral_enabled)            AS marchands_parrainage_actif,
  (SELECT count(*) FROM public.clients c
    WHERE c.referred_by_client_id IS NOT NULL
      AND c.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.referral_credits r
                       WHERE r.filleul_client_id = c.id))                    AS filleuls_lies_sans_credit;
