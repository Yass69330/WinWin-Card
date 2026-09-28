-- ============================================================================
-- Audit WinWin — segment 6 : infrastructure — requêtes de mesure
-- ============================================================================
-- LECTURE SEULE. Aucune requête n'écrit, ne crée ni ne modifie quoi que ce soit.
-- À exécuter dans l'éditeur SQL Supabase, UNE requête à la fois (I1 à I3).
-- Pour chaque résultat : bouton « Copy » / export CSV, puis coller dans le fil.
--
-- Les résultats ne contiennent QUE des comptages, des tailles, des durées, des
-- dates et des réglages de la base : aucune donnée client, aucun numéro de
-- série, aucun nom de marchand, aucun texte de requête. Ils peuvent figurer
-- tels quels dans un rapport public.
--
-- Chaque requête rend moins de 100 lignes (l'éditeur tronque au-delà sans le
-- dire) : I1 19 lignes ; I2 4 lignes ; I3 24 lignes plus une ligne par rôle
-- connecté (moins de 10 attendues).
--
-- Testées avant envoi sur une base rejouée depuis le dépôt (schema.sql +
-- migrations 002→047 + rgpd_effacement.sql, PostgreSQL 16 : 48 fichiers,
-- 0 échec), avec les GRANT service_role des 7 tables centrales (00a §5.1) et
-- pg_stat_statements actif : d'abord à vide (aucune erreur), puis sur un jeu
-- fabriqué dont chaque résultat était connu d'avance (voir l'en-tête de
-- chaque requête). Exécutées sous un rôle sans privilège de superutilisateur
-- qui, comme le rôle postgres de l'éditeur (propriétaire des tables), n'est
-- pas filtré par la RLS ; puis sous un rôle sans droit de lire les
-- statistiques des autres rôles : aucune erreur, I3 le signale alors dans
-- « entrées illisibles pour ce rôle ». Pour I3, chaque étape du scan a été
-- rejouée sous le rôle service_role dans la forme que PostgREST lui donne
-- (code source de PostgREST, dépôt officiel, lu le 28/09 : QueryBuilder.hs,
-- SqlFragment.hs), avec des témoins négatifs ; la ligne des slots de
-- réplication a été vérifiée avec un slot créé puis supprimé sur la base
-- locale.
--
-- Durées mesurées sur la base rejouée, JIT désactivé comme en production
-- (05, T4) : volume de la production, I1 23 ms, I2 15 ms, I3 7 ms ; dix fois
-- plus, I1 0,10 s, I2 61 ms, I3 6 ms.
--
-- Conventions : heures en UTC, comme le serveur et la base. « Fenêtre de
-- sauvegarde » : de 03:06 UTC à 03:06 UTC le lendemain, heure de la dernière
-- sauvegarde quotidienne relevée par Yass le 28/09 (03:06:18 UTC). L'heure
-- exacte peut varier de quelques minutes d'un jour à l'autre (HYPOTHÈSE) :
-- sans effet sur des comptes de 24 heures.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- I1 — Le stock : taille, poids par ligne, croissance, entretien
-- ----------------------------------------------------------------------------
-- Pourquoi : chiffrer ce qui remplit le disque (8 Go inclus dans l'offre Pro ;
-- avec le spend cap activé, la base passe en lecture seule à 95 % du disque,
-- documentation Supabase), à quelle vitesse, et ce que coûte chaque ligne à la
-- cible. Une ligne par table de l'application, puis la taille de la base.
-- Colonnes :
--   lignes            : comptage exact ;
--   taille_ko         : table, index et TOAST compris ;
--   octets_par_ligne  : taille_ko ramenée à une ligne (index compris) ; n'a de
--                       sens qu'au-delà de quelques centaines de lignes (une
--                       table presque vide pèse ses pages et ses index vides) ;
--   creees_24h/7j/30j : lignes créées, d'après la colonne d'horodatage de la
--                       table (scans.date_scan, consentements.horodatage,
--                       notification_envois.envoye_le, workflow_executions.
--                       executed_at, avis_clics.clique_le, sinon created_at) ;
--   modifiees_24h     : lignes dont updated_at a bougé en 24 h (clients,
--                       passes, marchands seulement ; vide ailleurs) ;
--   ins_cumul, maj_cumul, sup_cumul, lignes_mortes : compteurs de la base
--                       depuis la date « statistiques de la base depuis » d'I3 ;
--   dernier_vacuum    : dernier nettoyage, manuel ou automatique.
-- Lignes « base » : taille totale de la base, puis par schéma ; « autres » =
-- catalogue du système et schémas de la plateforme hors storage et auth. Les
-- fichiers du bucket ne sont pas dans la base (seules leurs fiches, dans
-- storage) : leur volume a été relevé au segment 4 (K4).
-- Attendu sur le jeu fabriqué (lignes ; créées en 24 h, 7 j, 30 j ; modifiées
-- en 24 h) : scans 8 (7, 7, 8) ; clients 5 (3, 3, 4 ; 5) ; passes 5 (3, 3,
-- 4 ; 4) ; device_tokens 3 (3, 3, 3) ; workflow_executions 6 (2, 6, 6) ;
-- notification_envois 5 (5, 5, 5) ; consentements 2 (2, 2, 2) ; marchands 2
-- (0, 0, 0 ; 1) ; avis_clics 1 (1, 1, 1) ; les 5 autres tables 0 ; obtenu.
-- ----------------------------------------------------------------------------
WITH t(o, nom, lignes, creees_24h, creees_7j, creees_30j, modifiees_24h) AS (
  SELECT 1, 'scans', count(*),
         count(*) FILTER (WHERE date_scan >= now() - interval '1 day'),
         count(*) FILTER (WHERE date_scan >= now() - interval '7 days'),
         count(*) FILTER (WHERE date_scan >= now() - interval '30 days'), NULL::bigint
    FROM public.scans
  UNION ALL
  SELECT 2, 'clients', count(*),
         count(*) FILTER (WHERE created_at >= now() - interval '1 day'),
         count(*) FILTER (WHERE created_at >= now() - interval '7 days'),
         count(*) FILTER (WHERE created_at >= now() - interval '30 days'),
         count(*) FILTER (WHERE updated_at >= now() - interval '1 day')
    FROM public.clients
  UNION ALL
  SELECT 3, 'passes', count(*),
         count(*) FILTER (WHERE created_at >= now() - interval '1 day'),
         count(*) FILTER (WHERE created_at >= now() - interval '7 days'),
         count(*) FILTER (WHERE created_at >= now() - interval '30 days'),
         count(*) FILTER (WHERE updated_at >= now() - interval '1 day')
    FROM public.passes
  UNION ALL
  SELECT 4, 'device_tokens', count(*),
         count(*) FILTER (WHERE created_at >= now() - interval '1 day'),
         count(*) FILTER (WHERE created_at >= now() - interval '7 days'),
         count(*) FILTER (WHERE created_at >= now() - interval '30 days'), NULL
    FROM public.device_tokens
  UNION ALL
  SELECT 5, 'workflow_executions', count(*),
         count(*) FILTER (WHERE executed_at >= now() - interval '1 day'),
         count(*) FILTER (WHERE executed_at >= now() - interval '7 days'),
         count(*) FILTER (WHERE executed_at >= now() - interval '30 days'), NULL
    FROM public.workflow_executions
  UNION ALL
  SELECT 6, 'notification_envois', count(*),
         count(*) FILTER (WHERE envoye_le >= now() - interval '1 day'),
         count(*) FILTER (WHERE envoye_le >= now() - interval '7 days'),
         count(*) FILTER (WHERE envoye_le >= now() - interval '30 days'), NULL
    FROM public.notification_envois
  UNION ALL
  SELECT 7, 'notification_logs', count(*),
         count(*) FILTER (WHERE created_at >= now() - interval '1 day'),
         count(*) FILTER (WHERE created_at >= now() - interval '7 days'),
         count(*) FILTER (WHERE created_at >= now() - interval '30 days'), NULL
    FROM public.notification_logs
  UNION ALL
  SELECT 8, 'consentements', count(*),
         count(*) FILTER (WHERE horodatage >= now() - interval '1 day'),
         count(*) FILTER (WHERE horodatage >= now() - interval '7 days'),
         count(*) FILTER (WHERE horodatage >= now() - interval '30 days'), NULL
    FROM public.consentements
  UNION ALL
  SELECT 9, 'marchands', count(*),
         count(*) FILTER (WHERE created_at >= now() - interval '1 day'),
         count(*) FILTER (WHERE created_at >= now() - interval '7 days'),
         count(*) FILTER (WHERE created_at >= now() - interval '30 days'),
         count(*) FILTER (WHERE updated_at >= now() - interval '1 day')
    FROM public.marchands
  UNION ALL
  SELECT 10, 'points_de_vente', count(*),
         count(*) FILTER (WHERE created_at >= now() - interval '1 day'),
         count(*) FILTER (WHERE created_at >= now() - interval '7 days'),
         count(*) FILTER (WHERE created_at >= now() - interval '30 days'), NULL
    FROM public.points_de_vente
  UNION ALL
  SELECT 11, 'referral_credits', count(*),
         count(*) FILTER (WHERE created_at >= now() - interval '1 day'),
         count(*) FILTER (WHERE created_at >= now() - interval '7 days'),
         count(*) FILTER (WHERE created_at >= now() - interval '30 days'), NULL
    FROM public.referral_credits
  UNION ALL
  SELECT 12, 'avis_clics', count(*),
         count(*) FILTER (WHERE clique_le >= now() - interval '1 day'),
         count(*) FILTER (WHERE clique_le >= now() - interval '7 days'),
         count(*) FILTER (WHERE clique_le >= now() - interval '30 days'), NULL
    FROM public.avis_clics
  UNION ALL
  SELECT 13, 'diagnostics_camera', count(*),
         count(*) FILTER (WHERE created_at >= now() - interval '1 day'),
         count(*) FILTER (WHERE created_at >= now() - interval '7 days'),
         count(*) FILTER (WHERE created_at >= now() - interval '30 days'), NULL
    FROM public.diagnostics_camera
  UNION ALL
  SELECT 14, 'workflows', count(*),
         count(*) FILTER (WHERE created_at >= now() - interval '1 day'),
         count(*) FILTER (WHERE created_at >= now() - interval '7 days'),
         count(*) FILTER (WHERE created_at >= now() - interval '30 days'), NULL
    FROM public.workflows
),
tailles AS (
  SELECT n.nspname, sum(pg_total_relation_size(c.oid)) AS octets
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p', 'm')
   GROUP BY n.nspname
),
base AS (
  SELECT pg_database_size(current_database()) AS totale,
         coalesce((SELECT octets FROM tailles WHERE nspname = 'public'), 0)  AS pub,
         coalesce((SELECT octets FROM tailles WHERE nspname = 'storage'), 0) AS sto,
         coalesce((SELECT octets FROM tailles WHERE nspname = 'auth'), 0)    AS aut
)
SELECT section, nom, lignes, taille_ko, octets_par_ligne, creees_24h, creees_7j,
       creees_30j, modifiees_24h, ins_cumul, maj_cumul, sup_cumul, lignes_mortes,
       dernier_vacuum
  FROM (
  SELECT 1 AS s, t.o, 'table' AS section, t.nom, t.lignes,
         round(pg_total_relation_size(c.oid) / 1024.0)                       AS taille_ko,
         round(pg_total_relation_size(c.oid)::numeric / nullif(t.lignes, 0)) AS octets_par_ligne,
         t.creees_24h, t.creees_7j, t.creees_30j, t.modifiees_24h,
         st.n_tup_ins AS ins_cumul, st.n_tup_upd AS maj_cumul, st.n_tup_del AS sup_cumul,
         st.n_dead_tup AS lignes_mortes,
         greatest(st.last_vacuum, st.last_autovacuum)::date AS dernier_vacuum
    FROM t
    JOIN pg_class c ON c.relname = t.nom AND c.relnamespace = 'public'::regnamespace
    LEFT JOIN pg_stat_user_tables st ON st.relid = c.oid
  UNION ALL
  SELECT 2, v.o, 'base', v.nom, NULL, round(v.octets / 1024.0), NULL, NULL, NULL, NULL,
         NULL, NULL, NULL, NULL, NULL, NULL
    FROM base,
         LATERAL (VALUES (1, 'base entière', base.totale),
                         (2, 'schéma public (application)', base.pub),
                         (3, 'schéma storage (fiches des fichiers)', base.sto),
                         (4, 'schéma auth (inutilisé, 03)', base.aut),
                         (5, 'autres : catalogue et plateforme',
                             base.totale - base.pub - base.sto - base.aut)) v(o, nom, octets)
  ) x
 ORDER BY s, o;


-- ----------------------------------------------------------------------------
-- I2 — Ce qu'une restauration ferait perdre
-- ----------------------------------------------------------------------------
-- Pourquoi : sans Point in Time, une restauration ramène la base à la dernière
-- sauvegarde quotidienne (vers 03:06 UTC) ; tout ce qui a été écrit depuis est
-- perdu. La requête compte, par fenêtre de sauvegarde (03:06 → 03:06 UTC), ce
-- qui disparaîtrait : la fenêtre en cours (ce qu'une restauration ferait perdre
-- si elle avait lieu au moment de la requête), la moyenne et le maximum des 30
-- fenêtres complètes précédentes, et la fenêtre la plus chargée en crédits.
-- Colonnes :
--   credits_tampons / credits_points : scans non annulés, selon le mode du
--                       marchand (mode actuel) ;
--   points_credites  : points crédités chez les marchands en points (colonne
--                       montant_credite, depuis la migration 031 du 13/08 ; à
--                       défaut, hausse du solde) ;
--   remises          : scans qui ont remis une récompense (le solde revenu en
--                       arrière rendrait la récompense de nouveau due) ;
--   annulations      : scans annulés pendant la fenêtre (l'annulation serait
--                       défaite : le crédit reviendrait) ;
--   clients_credites : clients distincts crédités ;
--   soldes_modifies  : clients inscrits AVANT la fenêtre dont la fiche a bougé
--                       depuis son début (scans, ajustements, parrainage,
--                       effacements) ; fenêtre en cours seulement (une
--                       modification plus récente efface la trace des plus
--                       anciennes) ;
--   inscriptions     : clients créés (chacun a aussi reçu un objet Google,
--                       00b §10) ; dont_iphone : parmi eux, ceux dont la carte
--                       est enregistrée sur au moins un appareil Apple (carte
--                       installée qui ne correspondrait plus à rien en base) ;
--   appareils        : appareils Apple enregistrés pendant la fenêtre ;
--   relances         : lignes de déduplication du cron (workflow_executions) ;
--   registre         : lignes du registre des envois ;
--   consentements, clics_avis : lignes créées ;
--   marchands_modifies : fiches marchand modifiées, fenêtre en cours seulement.
-- Attendu sur le jeu fabriqué (requête lancée moins d'une heure après sa
-- création, après 04:10 UTC) : fenêtre en cours 3 tampons, 2 points, 80 points
-- crédités, 1 remise, 1 annulation, 4 clients crédités, 2 soldes modifiés,
-- 2 inscriptions dont 1 iPhone, 2 appareils, 2 relances, 5 lignes de registre,
-- 2 consentements, 1 clic, 1 marchand modifié ; moyenne des 30 fenêtres :
-- 1,7 point crédité, 0,1 client crédité, 0,1 inscription, 0,1 relance, le
-- reste à 0,0 ; maximum : 1 tampon, 1 crédit en points, 50 points crédités,
-- 1 client crédité, 1 inscription dont 1 iPhone, 1 appareil, 4 relances ;
-- fenêtre complète la plus chargée : celle de la veille (1 tampon, 1 client
-- crédité, 1 inscription dont 1 iPhone, 1 appareil, 4 relances) ; obtenu.
-- ----------------------------------------------------------------------------
WITH cur AS (
  SELECT date_trunc('day', now() - interval '3 hours 6 minutes')
         + interval '3 hours 6 minutes' AS debut
),
f AS (
  SELECT g AS debut
    FROM cur, generate_series(cur.debut - interval '30 days', cur.debut, interval '1 day') g
),
sc AS (
  SELECT date_trunc('day', s.date_scan - interval '3 hours 6 minutes')
         + interval '3 hours 6 minutes' AS debut,
         count(*) FILTER (WHERE s.annule_le IS NULL AND m.type_programme = 'stamps') AS credits_tampons,
         count(*) FILTER (WHERE s.annule_le IS NULL AND m.type_programme = 'points') AS credits_points,
         coalesce(sum(coalesce(s.montant_credite,
                               greatest(s.stored_value_apres - s.stored_value_avant, 0)))
                  FILTER (WHERE s.annule_le IS NULL AND m.type_programme = 'points'), 0) AS points_credites,
         count(*) FILTER (WHERE s.annule_le IS NULL AND s.recompense_distribuee)     AS remises,
         count(DISTINCT s.client_id) FILTER (WHERE s.annule_le IS NULL)                AS clients_credites
    FROM public.scans s JOIN public.marchands m ON m.id = s.marchand_id
   WHERE s.date_scan >= (SELECT debut FROM cur) - interval '30 days'
   GROUP BY 1
),
an AS (
  SELECT date_trunc('day', annule_le - interval '3 hours 6 minutes')
         + interval '3 hours 6 minutes' AS debut, count(*) AS annulations
    FROM public.scans
   WHERE annule_le >= (SELECT debut FROM cur) - interval '30 days'
   GROUP BY 1
),
ins AS (
  SELECT date_trunc('day', c.created_at - interval '3 hours 6 minutes')
         + interval '3 hours 6 minutes' AS debut, count(*) AS inscriptions,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.device_tokens d
                                         WHERE d.client_id = c.id)) AS dont_iphone
    FROM public.clients c
   WHERE c.created_at >= (SELECT debut FROM cur) - interval '30 days'
   GROUP BY 1
),
app AS (
  SELECT date_trunc('day', created_at - interval '3 hours 6 minutes')
         + interval '3 hours 6 minutes' AS debut, count(*) AS appareils
    FROM public.device_tokens
   WHERE created_at >= (SELECT debut FROM cur) - interval '30 days'
   GROUP BY 1
),
wf AS (
  SELECT date_trunc('day', executed_at - interval '3 hours 6 minutes')
         + interval '3 hours 6 minutes' AS debut, count(*) AS relances
    FROM public.workflow_executions
   WHERE executed_at >= (SELECT debut FROM cur) - interval '30 days'
   GROUP BY 1
),
reg AS (
  SELECT date_trunc('day', envoye_le - interval '3 hours 6 minutes')
         + interval '3 hours 6 minutes' AS debut, count(*) AS registre
    FROM public.notification_envois
   WHERE envoye_le >= (SELECT debut FROM cur) - interval '30 days'
   GROUP BY 1
),
co AS (
  SELECT date_trunc('day', horodatage - interval '3 hours 6 minutes')
         + interval '3 hours 6 minutes' AS debut, count(*) AS consentements
    FROM public.consentements
   WHERE horodatage >= (SELECT debut FROM cur) - interval '30 days'
   GROUP BY 1
),
av AS (
  SELECT date_trunc('day', clique_le - interval '3 hours 6 minutes')
         + interval '3 hours 6 minutes' AS debut, count(*) AS clics_avis
    FROM public.avis_clics
   WHERE clique_le >= (SELECT debut FROM cur) - interval '30 days'
   GROUP BY 1
),
pf AS (
  SELECT f.debut, (f.debut = cur.debut) AS en_cours,
         coalesce(sc.credits_tampons, 0)  AS credits_tampons,
         coalesce(sc.credits_points, 0)   AS credits_points,
         coalesce(sc.points_credites, 0)  AS points_credites,
         coalesce(sc.remises, 0)          AS remises,
         coalesce(an.annulations, 0)      AS annulations,
         coalesce(sc.clients_credites, 0) AS clients_credites,
         coalesce(ins.inscriptions, 0)    AS inscriptions,
         coalesce(ins.dont_iphone, 0)     AS dont_iphone,
         coalesce(app.appareils, 0)       AS appareils,
         coalesce(wf.relances, 0)         AS relances,
         coalesce(reg.registre, 0)        AS registre,
         coalesce(co.consentements, 0)    AS consentements,
         coalesce(av.clics_avis, 0)       AS clics_avis
    FROM f CROSS JOIN cur
    LEFT JOIN sc  ON sc.debut  = f.debut  LEFT JOIN an  ON an.debut  = f.debut
    LEFT JOIN ins ON ins.debut = f.debut  LEFT JOIN app ON app.debut = f.debut
    LEFT JOIN wf  ON wf.debut  = f.debut  LEFT JOIN reg ON reg.debut = f.debut
    LEFT JOIN co  ON co.debut  = f.debut  LEFT JOIN av  ON av.debut  = f.debut
)
SELECT ligne, fenetre, credits_tampons, credits_points, points_credites, remises,
       annulations, clients_credites, soldes_modifies, inscriptions, dont_iphone,
       appareils, relances, registre, consentements, clics_avis, marchands_modifies
  FROM (
  SELECT 1 AS o, 'fenêtre en cours (perte si restauration maintenant)' AS ligne,
         to_char(debut, 'DD/MM HH24:MI') || ' → ' || to_char(now(), 'DD/MM HH24:MI') AS fenetre,
         credits_tampons::numeric, credits_points::numeric, points_credites::numeric,
         remises::numeric, annulations::numeric, clients_credites::numeric,
         (SELECT count(*) FROM public.clients
           WHERE updated_at >= pf.debut AND created_at < pf.debut)::numeric AS soldes_modifies,
         inscriptions::numeric, dont_iphone::numeric, appareils::numeric, relances::numeric,
         registre::numeric, consentements::numeric, clics_avis::numeric,
         (SELECT count(*) FROM public.marchands WHERE updated_at >= pf.debut)::numeric AS marchands_modifies
    FROM pf WHERE en_cours
  UNION ALL
  SELECT 2, 'moyenne des 30 fenêtres complètes', to_char(min(debut), 'DD/MM') || ' → '
         || to_char(max(debut) + interval '1 day', 'DD/MM'),
         round(avg(credits_tampons), 1), round(avg(credits_points), 1), round(avg(points_credites), 1),
         round(avg(remises), 1), round(avg(annulations), 1), round(avg(clients_credites), 1), NULL,
         round(avg(inscriptions), 1), round(avg(dont_iphone), 1), round(avg(appareils), 1),
         round(avg(relances), 1), round(avg(registre), 1), round(avg(consentements), 1),
         round(avg(clics_avis), 1), NULL
    FROM pf WHERE NOT en_cours
  UNION ALL
  SELECT 3, 'maximum sur une fenêtre complète (colonne par colonne)', NULL,
         max(credits_tampons), max(credits_points), max(points_credites), max(remises),
         max(annulations), max(clients_credites), NULL, max(inscriptions), max(dont_iphone),
         max(appareils), max(relances), max(registre), max(consentements), max(clics_avis), NULL
    FROM pf WHERE NOT en_cours
  UNION ALL
  (SELECT 4, 'fenêtre complète la plus chargée en crédits', to_char(debut, 'DD/MM HH24:MI'),
          credits_tampons, credits_points, points_credites, remises, annulations,
          clients_credites, NULL, inscriptions, dont_iphone, appareils, relances, registre,
          consentements, clics_avis, NULL
     FROM pf WHERE NOT en_cours
    ORDER BY credits_tampons + credits_points DESC, debut DESC LIMIT 1)
  ) x
 ORDER BY o;


-- ----------------------------------------------------------------------------
-- I3 — La charge et la plateforme
-- ----------------------------------------------------------------------------
-- Pourquoi : dire ce que la base fait réellement (connexions, cache, disque,
-- journaux de transactions), et quelle part des ≈ 200 ms d'une requête du
-- serveur est passée à exécuter dans la base (le reste est le trajet entre la
-- Californie et Paris, 00a §7, 02 §3.3).
-- Sections :
--   plateforme : version, dernier redémarrage, date de départ des compteurs de
--                la base, nombre maximal de connexions ;
--   connexions : instantané, une ligne par rôle connecté (nombre ouvertes, dont
--                actives ; « actives » vaut 0 si ce rôle ne voit pas l'état des
--                sessions des autres) ;
--   mémoire    : part des lectures servies par le cache, fichiers temporaires
--                (tris qui débordent de work_mem), transactions validées et
--                annulées, interblocages, depuis la date de départ ;
--   journaux   : archivage des journaux de transactions (un archivage actif
--                accompagne les sauvegardes physiques), volume écrit par jour,
--                réglages qui bornent leur place sur le disque, slots de
--                réplication (un slot inactif retient les journaux et remplit
--                le disque) ;
--   durée      : temps d'exécution DANS la base de chaque étape du scan, appels
--                du serveur seulement (rôle service_role, requêtes de premier
--                niveau), rangés d'après les tables et colonnes lues ; le texte
--                des requêtes n'est jamais rendu. Une rubrique partagée par
--                plusieurs routes le dit dans son libellé ;
--   charge     : total des appels du serveur, et part du temps écoulé passée à
--                exécuter (temps d'exécution cumulé ÷ durée depuis le départ
--                des compteurs de requêtes).
-- Attendu sur le jeu fabriqué (étapes rejouées sous service_role) : état du
-- marchand 3 appels ; statut de la boutique 2 ; test du réseau 2 ; client par
-- numéro de série 3 ; client par code de secours 1 ; crédit 3 ; texte de la
-- carte 3 ; journal du scan 3 ; témoins négatifs (écriture du texte par le
-- cron, lecture d'un client hors scan, révocation d'un marchand, même
-- lecture sous le rôle postgres) comptés nulle part ; entrées illisibles 0 ;
-- obtenu.
-- ----------------------------------------------------------------------------
WITH regles(o, rubrique, a, b, c, d, sauf) AS (VALUES
  (1, 'état du marchand (cache de 60 s ; 1 lecture par minute et par marchand)',
      '%from public.marchands%', '%public.marchands.token_version%', '%public.marchands.id =%', '%', '%update public.marchands%'),
  (2, 'statut de la boutique du jeton',
      '%from public.points_de_vente%', '%public.points_de_vente.actif%', '%public.points_de_vente.id =%', '%', NULL),
  (3, 'test du réseau (jeton marchand ; aussi à la connexion caisse)',
      '%from public.points_de_vente%', '%scanner_login is null%', '%limit%', '%', NULL),
  (4, 'client par numéro de série',
      '%from public.clients%', '%public.clients.pass_serial_number =%', '%referral_bonus_points%', '%', NULL),
  (5, 'client par code de secours',
      '%from public.clients%', '%public.clients.pass_serial_number ilike%', '%referral_bonus_points%', '%', NULL),
  (6, 'crédit (increment_stored_value)',
      '%public.increment_stored_value(%', '%', '%', '%', NULL),
  (7, 'texte de la carte (scan ; aussi parrainage, avis, ajustement, annulation)',
      '%update public.passes%', '%notification_message = pgrst_body.notification_message%',
      '%updated_at = pgrst_body.updated_at%', '%public.passes.marchand_id =%', NULL),
  (8, 'journal du scan',
      '%insert into public.scans%', '%', '%', '%', NULL)
),
st AS (
  SELECT row_number() OVER () AS k, lower(replace(q.query, '"', '')) AS t,
         q.calls, q.total_exec_time, q.max_exec_time
    FROM pg_stat_statements q
    JOIN pg_roles r ON r.oid = q.userid
   WHERE r.rolname = 'service_role'
     AND q.toplevel
),
classe AS (
  SELECT DISTINCT ON (st.k) st.k, g.o, st.calls, st.total_exec_time, st.max_exec_time
    FROM st
    JOIN regles g
      ON st.t LIKE g.a AND st.t LIKE g.b AND st.t LIKE g.c AND st.t LIKE g.d
     AND (g.sauf IS NULL OR st.t NOT LIKE g.sauf)
   ORDER BY st.k, g.o
),
db AS (SELECT * FROM pg_stat_database WHERE datname = current_database()),
lignes AS (
  SELECT 1 AS s, 1 AS o, 'plateforme' AS section, 'version' AS rubrique,
         NULL::bigint AS appels, NULL::numeric AS moyenne_ms, NULL::numeric AS max_ms,
         current_setting('server_version') AS valeur
  UNION ALL
  SELECT 1, 2, 'plateforme', 'dernier redémarrage de la base', NULL, NULL, NULL,
         to_char(pg_postmaster_start_time() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC'
  UNION ALL
  SELECT 1, 3, 'plateforme', 'statistiques de la base depuis', NULL, NULL, NULL,
         coalesce(to_char((SELECT stats_reset FROM db) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC',
                  'jamais remises à zéro')
  UNION ALL
  SELECT 1, 4, 'plateforme', 'connexions maximales (max_connections)', NULL, NULL, NULL,
         current_setting('max_connections')
  UNION ALL
  SELECT 2, row_number() OVER (ORDER BY count(*) DESC, usename), 'connexions',
         'rôle ' || coalesce(usename::text, '(inconnu)'), NULL, NULL, NULL,
         'ouvertes : ' || count(*) || ' ; actives : ' || count(*) FILTER (WHERE state = 'active')
    FROM pg_stat_activity
   WHERE backend_type = 'client backend'
   GROUP BY usename
  UNION ALL
  SELECT 3, 1, 'mémoire', 'lectures servies par le cache (%)', NULL, NULL, NULL,
         (SELECT round(100.0 * blks_hit / nullif(blks_hit + blks_read, 0), 2)::text FROM db)
  UNION ALL
  SELECT 3, 2, 'mémoire', 'fichiers temporaires (débordements de work_mem)', NULL, NULL, NULL,
         (SELECT temp_files || ' fichiers, ' || pg_size_pretty(temp_bytes) FROM db)
  UNION ALL
  SELECT 3, 3, 'mémoire', 'transactions validées / annulées', NULL, NULL, NULL,
         (SELECT xact_commit || ' / ' || xact_rollback FROM db)
  UNION ALL
  SELECT 3, 4, 'mémoire', 'interblocages', NULL, NULL, NULL,
         (SELECT deadlocks::text FROM db)
  UNION ALL
  SELECT 4, 1, 'journaux', 'archivage des journaux (archive_mode)', NULL, NULL, NULL,
         current_setting('archive_mode')
  UNION ALL
  SELECT 4, 2, 'journaux', 'journaux archivés, dernier archivage, échecs', NULL, NULL, NULL,
         (SELECT archived_count || ' ; ' ||
                 coalesce(to_char(last_archived_time AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC', 'aucun')
                 || ' ; ' || failed_count || ' échec(s)'
            FROM pg_stat_archiver)
  UNION ALL
  SELECT 4, 3, 'journaux', 'journaux écrits par jour (moyenne depuis le départ)', NULL, NULL, NULL,
         (SELECT pg_size_pretty((wal_bytes / greatest(extract(epoch FROM now() - stats_reset) / 86400, 1))::bigint)
                 || ' par jour, depuis le '
                 || to_char(stats_reset AT TIME ZONE 'UTC', 'YYYY-MM-DD')
            FROM pg_stat_wal)
  UNION ALL
  SELECT 4, 4, 'journaux', 'place des journaux : max_wal_size / min_wal_size / wal_keep_size', NULL, NULL, NULL,
         current_setting('max_wal_size') || ' / ' || current_setting('min_wal_size') || ' / '
         || current_setting('wal_keep_size')
  UNION ALL
  SELECT 4, 5, 'journaux', 'slots de réplication : nombre, actifs, journaux retenus au plus', NULL, NULL, NULL,
         (SELECT count(*) || ' ; ' || count(*) FILTER (WHERE active) || ' ; '
                 || coalesce(pg_size_pretty(max(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn))::bigint), '0 bytes')
            FROM pg_replication_slots)
  UNION ALL
  SELECT 5, g.o, 'durée', g.rubrique,
         coalesce(sum(c.calls), 0)::bigint,
         round((sum(c.total_exec_time) / nullif(sum(c.calls), 0))::numeric, 2),
         round(max(c.max_exec_time)::numeric, 1),
         NULL
    FROM regles g LEFT JOIN classe c ON c.o = g.o
   GROUP BY g.o, g.rubrique
  UNION ALL
  SELECT 6, 1, 'charge', 'appels du serveur à la base (service_role, tous)',
         sum(st.calls)::bigint,
         round((sum(st.total_exec_time) / nullif(sum(st.calls), 0))::numeric, 2),
         round(max(st.max_exec_time)::numeric, 1),
         (SELECT round(sum(st2.calls) / greatest(extract(epoch FROM now() - i.stats_reset) / 86400, 1))
                 || ' appels par jour ; base occupée '
                 || round((100 * sum(st2.total_exec_time) / 1000
                           / greatest(extract(epoch FROM now() - i.stats_reset), 1))::numeric, 3)
                 || ' % du temps écoulé'
            FROM st st2, pg_stat_statements_info i GROUP BY i.stats_reset)
    FROM st
  UNION ALL
  SELECT 6, 2, 'charge', 'statistiques des requêtes depuis', NULL, NULL, NULL,
         (SELECT to_char(stats_reset AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC'
            FROM pg_stat_statements_info)
  UNION ALL
  SELECT 6, 3, 'charge', 'entrées illisibles pour ce rôle', NULL, NULL, NULL,
         (SELECT count(*) FROM pg_stat_statements WHERE query = '<insufficient privilege>')::text
)
SELECT section, rubrique, appels, moyenne_ms, max_ms, valeur
  FROM lignes
 ORDER BY s, o;


-- ============================================================================
-- Requêtes de suivi FACULTATIVES, ajoutées après lecture des résultats du
-- 28/09 ; testées comme les autres. Chacune tranche une hypothèse du rapport.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- I3b — D'où viennent les fichiers temporaires ? (facultative)
-- ----------------------------------------------------------------------------
-- Pourquoi : I3 a relevé 57 689 fichiers temporaires, 94 Go, depuis le 07/05,
-- pour une base de 22 Mo. Un fichier temporaire naît quand un tri ou un
-- regroupement dépasse work_mem (2 Mo). Cette requête range l'écriture
-- temporaire par rôle, d'après pg_stat_statements (compteurs depuis le 23/05,
-- texte des requêtes jamais rendu) : service_role = le serveur de WinWin ;
-- les autres rôles = la plateforme Supabase, le tableau de bord, l'éditeur.
-- La dernière ligne rappelle le total de la base (compteur depuis le 07/05).
-- Colonnes : entrees_qui_debordent = requêtes distinctes ayant écrit au moins
-- un bloc temporaire ; temp_ecrit_mo = volume écrit ; pire_entree_mo = la
-- requête distincte qui a le plus écrit, tous appels cumulés.
-- Attendu sur le jeu fabriqué (un tri forcé à déborder sous service_role) :
-- service_role 1 entrée qui déborde, plus de 1 Mo écrit ; les autres rôles
-- 0 ; obtenu.
-- ----------------------------------------------------------------------------
SELECT role, appels, entrees_qui_debordent, fichiers_temporaires, temp_ecrit_mo,
       pire_entree_mo
  FROM (
  SELECT 1 AS o, r.rolname::text AS role, sum(q.calls)::bigint AS appels,
         count(*) FILTER (WHERE q.temp_blks_written > 0) AS entrees_qui_debordent,
         NULL::bigint AS fichiers_temporaires,
         round(sum(q.temp_blks_written) * current_setting('block_size')::numeric / 1048576, 1) AS temp_ecrit_mo,
         round(max(q.temp_blks_written) * current_setting('block_size')::numeric / 1048576, 1) AS pire_entree_mo
    FROM pg_stat_statements q JOIN pg_roles r ON r.oid = q.userid
   GROUP BY r.rolname
  UNION ALL
  SELECT 2, 'toute la base (depuis '
            || coalesce('le ' || to_char(stats_reset AT TIME ZONE 'UTC', 'YYYY-MM-DD'), 'toujours') || ')',
         NULL, NULL, temp_files, round(temp_bytes / 1048576.0, 1), NULL
    FROM pg_stat_database WHERE datname = current_database()
  ) x
 ORDER BY o, temp_ecrit_mo DESC NULLS LAST, role;


-- ----------------------------------------------------------------------------
-- I3c — Des crédits sans ligne de journal depuis le 23/05 ? (facultative)
-- ----------------------------------------------------------------------------
-- Pourquoi : I3 compte, depuis le 23/05 22:34 UTC, 2 271 crédits réussis
-- (increment_stored_value) et 2 289 lignes de journal écrites (insertions dans
-- scans), autant que de lignes dans la table. Seul le scan appelle cette
-- fonction et écrit le journal (scan.js:121, :174). Jusqu'au commit d0a43a6
-- (04/06/2026 10:50:36 UTC), le scan créditait par une simple mise à jour du
-- solde, sans la fonction : ces scans ont une ligne sans crédit compté. Si N
-- scans ont été écrits avant la mise en production de d0a43a6, les crédits
-- réussis restés sans ligne valent N − 18. La requête donne le nombre de scans
-- écrits avant chaque borne, pour situer N. La date exacte de la mise en
-- production n'est pas connue (commit à 10:50 le 04/06 ; migration 012 à
-- passer avant) : si le compte reste à 18 autour de cette date, aucun crédit
-- réussi n'a perdu sa ligne depuis le 23/05. Scans annulés compris (leur
-- ligne a bien été écrite).
-- Attendu sur le jeu fabriqué (3 scans le 01/06, 2 le 04/06 à 09:00, 1 le
-- 04/06 à 12:00, 1 le 05/06) : 0, 3, 3, 3, 5, 6, 7, 7 ; obtenu.
-- ----------------------------------------------------------------------------
SELECT b.rubrique, c.scans
  FROM (VALUES
    (1, 'scans écrits avant le 23/05 22:34 UTC (départ des statistiques de requêtes)', timestamptz '2026-05-23 22:34:00+00'),
    (2, 'scans écrits avant la fin du 01/06 (UTC)',                                   timestamptz '2026-06-02 00:00:00+00'),
    (3, 'scans écrits avant la fin du 02/06',                                          timestamptz '2026-06-03 00:00:00+00'),
    (4, 'scans écrits avant la fin du 03/06',                                          timestamptz '2026-06-04 00:00:00+00'),
    (5, 'scans écrits avant le 04/06 10:50:36 UTC (commit d0a43a6)',                   timestamptz '2026-06-04 10:50:36+00'),
    (6, 'scans écrits avant la fin du 04/06',                                          timestamptz '2026-06-05 00:00:00+00'),
    (7, 'scans écrits avant la fin du 05/06',                                          timestamptz '2026-06-06 00:00:00+00'),
    (8, 'scans écrits avant la fin du 06/06',                                          timestamptz '2026-06-07 00:00:00+00')
  ) b(o, rubrique, borne)
  CROSS JOIN LATERAL (SELECT count(*) AS scans FROM public.scans s WHERE s.date_scan < b.borne) c
 ORDER BY b.o;


-- ----------------------------------------------------------------------------
-- I3d — Le 19e scan est-il passé avant la mise en ligne du crédit par
--        fonction ? (facultative)
-- ----------------------------------------------------------------------------
-- Pourquoi : I3c (28/09) donne 18 scans écrits avant le commit d0a43a6
-- (04/06 10:50:36 UTC) et 21 autres dans la journée du 04/06. L'API GitHub
-- date le push de d0a43a6 sur la branche de production à 10:50:41 UTC, et le
-- push suivant (7a6ce4e) à 13:03:32 UTC. Les crédits réussis restés sans
-- ligne de journal valent N − 18, où N est le nombre de scans écrits avant la
-- mise en ligne effective du nouveau code (push, construction, déploiement).
-- Lecture :
--   - compte encore à 18 à 11:00 : aucun crédit sans ligne depuis la mise en
--     ligne, si le déploiement a pris moins de dix minutes (HYPOTHÈSE forte) ;
--   - compte encore à 18 à 13:10 : même conclusion, sous la seule condition
--     que l'un des deux déploiements (10:50:41 ou 13:03:32) ait réussi ;
--   - sinon : au plus autant de crédits sans ligne que de scans entre le push
--     et la mise en ligne ; la liste des déploiements de Railway le tranche.
-- Attendu sur le jeu fabriqué (1 scan le 01/06, puis le 04/06 à 10:50:40,
-- 10:52, 10:58, 12:30, 13:05 et 14:00) : 2, 3, 3, 4, 4, 4, 5, 6, 6, 7 ;
-- obtenu. À vide : dix zéros. Durée : 9 ms.
-- ----------------------------------------------------------------------------
SELECT b.rubrique, c.scans
  FROM (VALUES
    ( 1, 'scans écrits avant le 04/06 10:50:41 UTC (push de d0a43a6)',          timestamptz '2026-06-04 10:50:41+00'),
    ( 2, 'scans écrits avant le 04/06 10:53 UTC',                               timestamptz '2026-06-04 10:53:00+00'),
    ( 3, 'scans écrits avant le 04/06 10:55 UTC',                               timestamptz '2026-06-04 10:55:00+00'),
    ( 4, 'scans écrits avant le 04/06 11:00 UTC',                               timestamptz '2026-06-04 11:00:00+00'),
    ( 5, 'scans écrits avant le 04/06 11:30 UTC',                               timestamptz '2026-06-04 11:30:00+00'),
    ( 6, 'scans écrits avant le 04/06 12:00 UTC',                               timestamptz '2026-06-04 12:00:00+00'),
    ( 7, 'scans écrits avant le 04/06 13:03:32 UTC (push suivant, 7a6ce4e)',    timestamptz '2026-06-04 13:03:32+00'),
    ( 8, 'scans écrits avant le 04/06 13:10 UTC',                               timestamptz '2026-06-04 13:10:00+00'),
    ( 9, 'scans écrits avant le 04/06 13:30 UTC',                               timestamptz '2026-06-04 13:30:00+00'),
    (10, 'scans écrits avant la fin du 04/06',                                  timestamptz '2026-06-05 00:00:00+00')
  ) b(o, rubrique, borne)
  CROSS JOIN LATERAL (SELECT count(*) AS scans FROM public.scans s WHERE s.date_scan < b.borne) c
 ORDER BY b.o;
