-- ============================================================================
-- Audit WinWin — segment 2 : scan et crédit — requêtes de mesure
-- ============================================================================
-- LECTURE SEULE. Aucune requête n'écrit, ne crée ni ne modifie quoi que ce soit.
-- À exécuter dans l'éditeur SQL Supabase, UNE requête à la fois (S1 à S7, puis C8).
-- Pour chaque résultat : bouton « Copy » / export CSV, puis coller dans le fil.
-- Chaque requête rend moins de 100 lignes (l'éditeur tronque au-delà sans le dire).
-- S2 est la seule qui grandit avec les données : 45 lignes attendues au 26/09.
-- Si l'éditeur affiche exactement 100 lignes, le signaler.
--
-- Testées avant envoi sur une base rejouée depuis le dépôt (schema.sql +
-- migrations 002→047 + rgpd_effacement.sql, PostgreSQL 16 : 48 fichiers,
-- 0 échec), d'abord à vide (aucune erreur, résultats nuls), puis sur un jeu
-- fabriqué dont chaque résultat était connu d'avance : 4 marchands (tampons,
-- points, réseau de 3 boutiques, seuil nul), 33 clients, 48 scans, 3 crédits de
-- parrainage, 3 lignes de registre, 2 mesures de diagnostic. Cas posés exprès :
-- chaîne propre, « ajouter un tampon » à 3 et 5 s, paire écrite à l'envers à
-- 0,4 s, doublon dans l'ordre à 1,5 s, doublon au seuil à 1,2 s, doublon points
-- de même montant à 1 s, ligne de scan manquante, ajustement tracé et non tracé,
-- premier scan parti d'un solde non nul, scan annulé, parrain plafonné en points
-- (perte 80), parrain intégral, parrain tampons à 10/10 (perte 1), deux
-- boutiques à 20 s, soldes hors normes, ligne de journal incohérente, collision
-- de code de secours, 5 scans à horodatages réglés à la milliseconde et 3 scans
-- que S7 doit écarter. Résultats : S1 conforme (4 tranches, 11 comptes), S2
-- 12/12 ruptures correctement expliquées, S3 3/3 verdicts, S4 conforme à un
-- calcul indépendant, S5 12/12, S6 11/11, S7 conforme au calcul manuel des
-- centiles (5 scans retenus, 3 écartés), C8 2/2. C7 de 00b, jouée sur le même
-- jeu, compte les mêmes 12 ruptures que S2 : les deux définitions concordent.
--
-- Convention : « client » = 8 premiers caractères de l'identifiant interne,
-- jamais de prénom. Heures en UTC.
--
-- Exécutées par Yass le 27/09 : S1 à S7 (résultats bruts : rapport 02, annexe A).
-- C8 non exécutée : Yass a vérifié directement qu'aucun marchand actif en mode
-- points n'a le parrainage allumé (décision de pilotage du 27/09).
-- En fin de fichier, quatre requêtes de SUIVI (S1b, S1c, S5b, S7b), facultatives,
-- ajoutées après lecture des résultats : chacune tranche une hypothèse du rapport.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- S1 — Scans consécutifs d'un même client : doublons et paires inversées
-- Chaque scan est comparé au scan précédent du même client (annulés compris :
-- un scan annulé a bien été envoyé par une caisse). Regroupé par écart de temps.
--   dont_points_meme_montant : en points, deux crédits de même montant. À moins
--     de quelques secondes, c'est la signature d'un renvoi de la même demande.
--   dont_remise_apres_franchissement : le premier scan a atteint le seuil, le
--     second fait la remise. Normal au passage suivant (tranche 5) ; à quelques
--     secondes, c'est un doublon au seuil qui avance la remise.
--   paires_inversees : le second scan (par date) finit là où le premier
--     commence. Le journal a été écrit dans le désordre : deux demandes se sont
--     chevauchées (la ligne est horodatée à son écriture, après le crédit).
--   marchands_concernes : affiché pour les écarts de moins d'une minute.
-- Attendu : tranche 1 (moins de 2 s) vide ou presque, chaque paire y étant un
-- probable double crédit ; tranche 2 non vide (le bouton « ajouter un tampon »
-- de la caisse sert à ça) ; paires_inversees = 0.
-- Au plus 5 lignes.
-- ----------------------------------------------------------------------------
WITH s AS (
  SELECT sc.client_id, sc.marchand_id, sc.date_scan,
         sc.stored_value_avant AS av, sc.stored_value_apres AS ap,
         sc.montant_credite, sc.point_de_vente_id, sc.annule_le,
         lag(sc.date_scan)          OVER w AS p_date,
         lag(sc.stored_value_avant) OVER w AS p_av,
         lag(sc.stored_value_apres) OVER w AS p_ap,
         lag(sc.montant_credite)    OVER w AS p_montant,
         lag(sc.point_de_vente_id)  OVER w AS p_pdv,
         lag(sc.annule_le)          OVER w AS p_annule
    FROM public.scans sc
  WINDOW w AS (PARTITION BY sc.client_id ORDER BY sc.date_scan, sc.id)
),
paires AS (
  SELECT s.*, m.type_programme, m.max_value, m.nom,
         extract(epoch FROM s.date_scan - s.p_date) AS ecart_s
    FROM s JOIN public.marchands m ON m.id = s.marchand_id
   WHERE s.p_date IS NOT NULL
)
SELECT CASE WHEN ecart_s < 2   THEN '1. moins de 2 s'
            WHEN ecart_s < 10  THEN '2. de 2 à 10 s'
            WHEN ecart_s < 60  THEN '3. de 10 à 60 s'
            WHEN ecart_s < 600 THEN '4. de 1 à 10 min'
            ELSE                    '5. 10 min et plus' END                          AS ecart,
       count(*)                                                                      AS paires,
       count(*) FILTER (WHERE type_programme = 'points')                             AS dont_points,
       count(*) FILTER (WHERE type_programme = 'points'
                          AND montant_credite = p_montant)                           AS dont_points_meme_montant,
       count(*) FILTER (WHERE point_de_vente_id IS NOT NULL AND p_pdv IS NOT NULL)   AS dont_jeton_boutique,
       count(*) FILTER (WHERE point_de_vente_id <> p_pdv)                            AS dont_deux_boutiques,
       count(*) FILTER (WHERE annule_le IS NOT NULL OR p_annule IS NOT NULL)         AS dont_une_annulee,
       count(*) FILTER (WHERE p_ap >= max_value AND av >= max_value)                 AS dont_remise_apres_franchissement,
       count(*) FILTER (WHERE ap = p_av AND p_ap <> av)                              AS paires_inversees,
       min(date_scan)::date                                                          AS premiere,
       max(date_scan)::date                                                          AS derniere,
       CASE WHEN max(ecart_s) < 60
            THEN string_agg(DISTINCT nom, ', ') END                                  AS marchands_concernes
  FROM paires
 GROUP BY 1
 ORDER BY 1;


-- ----------------------------------------------------------------------------
-- S2 — Les ruptures de chaîne du journal, une par une (transmis par 00b §11)
-- Une rupture : un scan non annulé dont le solde de départ n'est pas le solde
-- d'arrivée du scan précédent du même client (même définition que C7, qui en
-- comptait 45 le 26/09). Pour chacune, l'explication trouvée en base :
--   paire inversée / suite d'une paire inversée : journal écrit dans le désordre
--     (voir S1) ; une inversion produit jusqu'à trois ruptures ;
--   crédit de parrainage : le parrain a été crédité entre les deux scans ;
--   ajustement (registre) : un ajustement du dashboard est tracé entre les deux
--     scans (le registre n'existe que depuis le 25/09) ;
--   premier scan, solde de départ non nul : aucun scan avant celui-ci ;
--   sans explication en base : ajustement antérieur au registre, correction
--     SQL, ou ligne de scan manquante — indiscernables.
-- intervalle_couvert_par_registre : le scan précédent est postérieur au début
-- du registre ; seules ces ruptures peuvent être expliquées complètement.
-- Attendu : environ 45 lignes ; avant le registre, surtout « sans explication
-- en base » ; parmi les intervalles couverts, aucune « sans explication ».
-- ----------------------------------------------------------------------------
WITH t0 AS (
  SELECT min(envoye_le) AS t0 FROM public.notification_envois
),
s AS (
  SELECT sc.client_id, sc.marchand_id, sc.date_scan,
         sc.stored_value_avant AS av, sc.stored_value_apres AS ap,
         lag(sc.date_scan, 1)           OVER w AS p_date,
         lag(sc.stored_value_avant, 1)  OVER w AS p_av,
         lag(sc.stored_value_apres, 1)  OVER w AS p_ap,
         lag(sc.stored_value_avant, 2)  OVER w AS pp_av,
         lag(sc.stored_value_apres, 2)  OVER w AS pp_ap,
         lead(sc.date_scan, 1)          OVER w AS n_date,
         lead(sc.stored_value_apres, 1) OVER w AS n_ap
    FROM public.scans sc
   WHERE sc.annule_le IS NULL
  WINDOW w AS (PARTITION BY sc.client_id ORDER BY sc.date_scan, sc.id)
),
r AS (
  SELECT s.*, s.av - coalesce(s.p_ap, 0) AS saut
    FROM s
   WHERE s.av - coalesce(s.p_ap, 0) <> 0
)
SELECT r.date_scan::timestamp(0)                                                   AS rupture_le,
       m.nom                                                                       AS marchand,
       m.type_programme                                                            AS mode,
       m.max_value                                                                 AS seuil,
       left(r.client_id::text, 8)                                                  AS client,
       r.p_ap                                                                      AS apres_scan_precedent,
       r.av                                                                        AS avant_ce_scan,
       r.saut,
       date_trunc('second', r.date_scan - r.p_date)                                AS depuis_scan_precedent,
       CASE
         WHEN (r.p_date IS NOT NULL AND r.ap = r.p_av
               AND r.date_scan - r.p_date < interval '60 seconds')
           OR (r.n_date IS NOT NULL AND r.n_ap = r.av
               AND r.n_date - r.date_scan < interval '60 seconds')
           THEN 'paire inversée'
         WHEN r.pp_ap IS NOT NULL AND r.p_ap = r.pp_av AND r.av = r.pp_ap
           THEN 'suite d''une paire inversée'
         WHEN EXISTS (SELECT 1 FROM public.referral_credits rc
                       WHERE rc.parrain_client_id = r.client_id
                         AND rc.created_at <= r.date_scan
                         AND (r.p_date IS NULL OR rc.created_at > r.p_date))
           THEN 'crédit de parrainage'
         WHEN EXISTS (SELECT 1 FROM public.notification_envois n
                        JOIN public.clients c ON c.pass_serial_number = n.serial_number
                       WHERE c.id = r.client_id
                         AND n.source = 'ajustement'
                         AND n.envoye_le <= r.date_scan
                         AND (r.p_date IS NULL OR n.envoye_le > r.p_date))
           THEN 'ajustement (registre)'
         WHEN r.p_date IS NULL
           THEN 'premier scan, solde de départ non nul'
         ELSE 'sans explication en base'
       END                                                                         AS explication,
       coalesce(r.p_date >= (SELECT t0 FROM t0), false)                            AS intervalle_couvert_par_registre
  FROM r
  JOIN public.marchands m ON m.id = r.marchand_id
 ORDER BY r.date_scan;


-- ----------------------------------------------------------------------------
-- S3 — Suivi des crédits de parrainage (requête de suivi demandée par 00b §11)
-- credit_referral plafonne le solde du parrain au seuil (migration_015:33) et
-- ne journalise pas son avant/après. On le reconstitue par le journal du
-- parrain : son solde d'arrivée au dernier scan AVANT le crédit, et son solde
-- de départ au premier scan APRÈS (à défaut, son solde actuel). Puis on compare
-- à ce que donnerait le crédit sans plafond et avec plafond.
-- Le seuil lu est le seuil actuel du marchand (s'il a changé depuis le crédit,
-- le verdict peut être « indéterminé »).
-- Attendu : 1 ligne (un seul crédit en base au 26/09, en mode points selon C7).
-- Verdict « intégral », « plafonné : perte de N » ou « indéterminé ».
-- ----------------------------------------------------------------------------
WITH x AS (
  SELECT rc.created_at, rc.points_credited AS bonus, rc.parrain_client_id,
         m.nom AS marchand, m.type_programme AS mode, m.max_value AS seuil,
         c.stored_value AS solde_actuel,
         (SELECT s.stored_value_apres FROM public.scans s
           WHERE s.client_id = rc.parrain_client_id AND s.annule_le IS NULL
             AND s.date_scan < rc.created_at
           ORDER BY s.date_scan DESC, s.id DESC LIMIT 1)                           AS apres_dernier_scan_avant,
         (SELECT s.stored_value_avant FROM public.scans s
           WHERE s.client_id = rc.parrain_client_id AND s.annule_le IS NULL
             AND s.date_scan > rc.created_at
           ORDER BY s.date_scan, s.id LIMIT 1)                                     AS avant_premier_scan_apres
    FROM public.referral_credits rc
    JOIN public.marchands m ON m.id = rc.marchand_id
    JOIN public.clients   c ON c.id = rc.parrain_client_id
),
y AS (
  SELECT x.*,
         coalesce(apres_dernier_scan_avant, 0)                                     AS avant,
         coalesce(avant_premier_scan_apres, solde_actuel)                          AS apres_observe,
         coalesce(apres_dernier_scan_avant, 0) + bonus                             AS attendu_sans_plafond,
         least(coalesce(apres_dernier_scan_avant, 0) + bonus, seuil)               AS attendu_avec_plafond
    FROM x
)
SELECT created_at::timestamp(0)                                                    AS credit_le,
       marchand, mode, seuil, bonus,
       left(parrain_client_id::text, 8)                                            AS parrain,
       avant,
       CASE WHEN apres_dernier_scan_avant IS NULL
            THEN 'aucun scan avant le crédit : 0 supposé' ELSE 'journal' END       AS source_avant,
       apres_observe,
       CASE WHEN avant_premier_scan_apres IS NULL
            THEN 'solde actuel (aucun scan depuis)' ELSE 'journal' END             AS source_apres,
       attendu_sans_plafond, attendu_avec_plafond,
       CASE
         WHEN attendu_avec_plafond < attendu_sans_plafond
          AND apres_observe = attendu_avec_plafond
           THEN 'plafonné : perte de ' || (attendu_sans_plafond - attendu_avec_plafond)
         WHEN apres_observe = attendu_sans_plafond
           THEN 'intégral'
         ELSE 'indéterminé : une autre écriture a eu lieu entre le crédit et la lecture'
       END                                                                         AS verdict
  FROM y
 ORDER BY created_at;


-- ----------------------------------------------------------------------------
-- S4 — Rafales : le pire nombre de scans en une minute et en 15 minutes
-- Sur 30 jours, à trois niveaux : une boutique (jeton caisse de réseau), un
-- marchand (tous ses scans), toute la plateforme. Scans annulés compris.
-- Sert aux seuils de rupture en activité, et à situer le limiteur global du
-- serveur (300 requêtes par 15 min et par adresse IP, index.js:42-47) : une
-- boutique ou un commerce mono-site passe par une seule adresse.
--   creneaux_a_3_scans_ou_plus : nombre de créneaux (minute ou quart d'heure)
--     où ce niveau a reçu au moins 3 scans.
-- Attendu : au plus 6 lignes (les deux lignes « boutique » manquent si aucun
-- scan par jeton de boutique en 30 jours) ; pires valeurs de quelques scans,
-- très loin de 300 par quart d'heure.
-- ----------------------------------------------------------------------------
WITH s AS (
  SELECT sc.marchand_id, sc.point_de_vente_id,
         date_trunc('minute', sc.date_scan)                                         AS minute,
         date_bin('15 minutes', sc.date_scan, timestamptz '2000-01-01 00:00:00+00') AS quart
    FROM public.scans sc
   WHERE sc.date_scan >= now() - interval '30 days'
),
c AS (
  SELECT 'boutique' AS niveau, 'minute' AS pas, point_de_vente_id::text AS qui, minute AS t, count(*) AS n
    FROM s WHERE point_de_vente_id IS NOT NULL GROUP BY 3, 4
  UNION ALL
  SELECT 'boutique', '15 min', point_de_vente_id::text, quart, count(*)
    FROM s WHERE point_de_vente_id IS NOT NULL GROUP BY 3, 4
  UNION ALL
  SELECT 'marchand', 'minute', marchand_id::text, minute, count(*) FROM s GROUP BY 3, 4
  UNION ALL
  SELECT 'marchand', '15 min', marchand_id::text, quart,  count(*) FROM s GROUP BY 3, 4
  UNION ALL
  SELECT 'plateforme', 'minute', NULL, minute, count(*) FROM s GROUP BY 4
  UNION ALL
  SELECT 'plateforme', '15 min', NULL, quart,  count(*) FROM s GROUP BY 4
),
pire AS (
  SELECT DISTINCT ON (niveau, pas) niveau, pas, qui, t, n
    FROM c
   ORDER BY niveau, pas, n DESC, t DESC
)
SELECT p.niveau, p.pas,
       p.n                                                                          AS pire_nombre_de_scans,
       p.t::timestamp(0)                                                            AS debut_du_creneau_utc,
       CASE p.niveau
         WHEN 'boutique'   THEN (SELECT pv.nom || ' (' || m.nom || ')'
                                   FROM public.points_de_vente pv
                                   JOIN public.marchands m ON m.id = pv.marchand_id
                                  WHERE pv.id::text = p.qui)
         WHEN 'marchand'   THEN (SELECT m.nom FROM public.marchands m WHERE m.id::text = p.qui)
         ELSE 'toute la plateforme' END                                             AS ou,
       (SELECT count(*) FROM c WHERE c.niveau = p.niveau AND c.pas = p.pas
                                 AND c.n >= 3)                                      AS creneaux_a_3_scans_ou_plus
  FROM pire p
 ORDER BY CASE p.niveau WHEN 'boutique' THEN 1 WHEN 'marchand' THEN 2 ELSE 3 END, p.pas DESC;


-- ----------------------------------------------------------------------------
-- S5 — Usage réel des branches du scan (preuves pour « est-ce nécessaire ? »)
-- Une ligne par rubrique. Sert au brief §5 (une suppression ne se propose que
-- sur preuve d'usage nul) et à Ponytail.
--   3 : seuil affiché différent du seuil réel (display_max_value) ;
--   5 : jeton marchand chez un réseau provisionné, compté après la création de
--       sa première boutique provisionnée : doit être 0 (durcissement) ;
--   6 : l'annulation du dernier scan est-elle utilisée ;
--   8 : montants saisis en mode points (sens du montant pour les caisses) ;
--   9 : collisions de code de secours existantes (même marchand, mêmes 6
--       derniers caractères du numéro de série) ;
--  11 : repli de connexion caisse par e-mail (scanner-auth.js:68-74) ;
--  12 : l'outil de diagnostic caméra est-il encore utilisé.
-- Attendu : 12 lignes, des comptes ; rubrique 5 : « … : 0 » ; rubrique 9 : 0.
-- ----------------------------------------------------------------------------
WITH t0 AS (SELECT min(envoye_le) AS t0 FROM public.notification_envois),
ma AS (SELECT * FROM public.marchands WHERE actif),
reseaux AS (
  SELECT marchand_id, count(*) AS boutiques, min(created_at) AS premiere_boutique
    FROM public.points_de_vente
   WHERE deleted_at IS NULL AND scanner_login IS NOT NULL
   GROUP BY marchand_id
),
ann AS (
  SELECT sc.marchand_id, sc.annule_le,
         extract(epoch FROM sc.annule_le - sc.date_scan) AS delai_s
    FROM public.scans sc WHERE sc.annule_le IS NOT NULL
),
pts AS (
  SELECT sc.montant_credite
    FROM public.scans sc JOIN public.marchands m ON m.id = sc.marchand_id
   WHERE m.type_programme = 'points' AND sc.montant_credite IS NOT NULL
     AND sc.date_scan >= now() - interval '90 days'
),
cpm AS (
  SELECT marchand_id, count(*) AS n
    FROM public.clients WHERE deleted_at IS NULL GROUP BY marchand_id
),
coll AS (
  SELECT marchand_id, right(lower(pass_serial_number), 6) AS code, count(*) AS n
    FROM public.clients WHERE deleted_at IS NULL
   GROUP BY 1, 2 HAVING count(*) > 1
)
SELECT * FROM (
  SELECT 1 AS ordre, 'marchands actifs en mode points' AS rubrique,
         (SELECT count(*) FROM ma WHERE type_programme = 'points')::text AS valeur,
         (SELECT string_agg(nom, ', ' ORDER BY nom) FROM ma WHERE type_programme = 'points') AS detail
  UNION ALL
  SELECT 2, 'marchands actifs en mode tampons',
         (SELECT count(*) FROM ma WHERE type_programme = 'stamps')::text, NULL
  UNION ALL
  SELECT 3, 'seuil affiché différent du seuil réel (display_max_value)',
         (SELECT count(*) FROM public.marchands
           WHERE display_max_value IS NOT NULL AND display_max_value <> max_value)::text,
         (SELECT string_agg(nom || ' : ' || display_max_value || ' affiché / ' || max_value || ' réel', ', ' ORDER BY nom)
            FROM public.marchands WHERE display_max_value IS NOT NULL AND display_max_value <> max_value)
  UNION ALL
  SELECT 4, 'réseaux provisionnés (au moins une boutique avec identifiant caisse)',
         (SELECT count(*) FROM reseaux)::text,
         (SELECT coalesce(sum(boutiques), 0) || ' boutiques provisionnées' FROM reseaux)
  UNION ALL
  SELECT 5, 'scans des 30 derniers jours : jeton boutique / jeton marchand',
         (SELECT count(*) FILTER (WHERE point_de_vente_id IS NOT NULL) || ' / '
              || count(*) FILTER (WHERE point_de_vente_id IS NULL)
            FROM public.scans WHERE date_scan >= now() - interval '30 days'),
         (SELECT 'dont jeton marchand chez un réseau provisionné : ' || count(*)
            FROM public.scans sc JOIN reseaux r ON r.marchand_id = sc.marchand_id
           WHERE sc.point_de_vente_id IS NULL
             AND sc.date_scan >= now() - interval '30 days'
             AND sc.date_scan > r.premiere_boutique)
  UNION ALL
  SELECT 6, 'annulations : total / 30 derniers jours',
         (SELECT count(*) || ' / ' || count(*) FILTER (WHERE annule_le >= now() - interval '30 days') FROM ann),
         (SELECT count(DISTINCT marchand_id) || ' marchand(s) ; délai scan → annulation : médiane '
              || coalesce(round(percentile_cont(0.5) WITHIN GROUP (ORDER BY delai_s))::text, '-')
              || ' s, max ' || coalesce(round(max(delai_s))::text, '-') || ' s' FROM ann)
  UNION ALL
  SELECT 7, 'ajustements du solde tracés au registre (depuis ' || coalesce((SELECT t0 FROM t0)::date::text, '-') || ')',
         (SELECT count(DISTINCT lot)::text FROM public.notification_envois WHERE source = 'ajustement'),
         (SELECT 'annulations tracées au registre : ' || count(DISTINCT lot)
            FROM public.notification_envois WHERE source = 'annulation')
  UNION ALL
  SELECT 8, 'mode points, montant crédité par scan sur 90 j : médiane / p95 / max',
         (SELECT coalesce(percentile_cont(0.5)  WITHIN GROUP (ORDER BY montant_credite)::text, '-') || ' / '
              || coalesce(round(percentile_cont(0.95) WITHIN GROUP (ORDER BY montant_credite)::numeric)::text, '-') || ' / '
              || coalesce(max(montant_credite)::text, '-') FROM pts),
         (SELECT count(*) || ' scans' FROM pts)
  UNION ALL
  SELECT 9, 'code de secours : collisions existantes (même marchand, mêmes 6 derniers caractères)',
         (SELECT count(*)::text FROM coll),
         (SELECT coalesce(sum(n), 0) || ' clients concernés' FROM coll)
  UNION ALL
  SELECT 10, 'clients actifs par marchand : max / médiane',
         (SELECT coalesce(max(n)::text, '-') || ' / ' || coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY n)::text, '-') FROM cpm),
         NULL
  UNION ALL
  SELECT 11, 'email_contact renseigné (repli de connexion caisse par e-mail)',
         (SELECT count(*)::text FROM public.marchands WHERE email_contact IS NOT NULL AND email_contact <> ''),
         (SELECT 'adresses partagées par plusieurs marchands : ' || count(*) FROM (
            SELECT lower(email_contact) FROM public.marchands
             WHERE email_contact IS NOT NULL AND email_contact <> ''
             GROUP BY 1 HAVING count(*) > 1) d)
  UNION ALL
  SELECT 12, 'diagnostic caméra : mesures enregistrées',
         (SELECT count(*)::text FROM public.diagnostics_camera),
         (SELECT 'dernière le ' || coalesce(max(created_at)::date::text, '-') || ', '
              || count(DISTINCT etiquette) || ' étiquette(s)' FROM public.diagnostics_camera)
) t
ORDER BY ordre;


-- ----------------------------------------------------------------------------
-- S6 — Intégrité des soldes et du journal
-- Rien en base n'interdit un solde négatif ni un seuil nul (aucune contrainte
-- CHECK sur clients.stored_value ni sur marchands.max_value) : on vérifie.
-- Les contrôles 8 à 10 vérifient que chaque ligne du journal suit les règles de
-- increment_stored_value (tampons : +1, remise à 0 ; points : +montant, remise
-- avec report du surplus). Le seuil lu est le seuil actuel : un seuil modifié
-- depuis peut expliquer un écart au contrôle 10, et un solde au-dessus du seuil
-- en tampons (contrôle 2) vient d'un ajustement ou d'un seuil abaissé.
-- Attendu : 0 aux contrôles 1, 5, 6, 7, 8, 9, 10 ; contrôle 2 à lire.
-- 11 lignes.
-- ----------------------------------------------------------------------------
WITH cl AS (
  SELECT c.stored_value, m.type_programme, m.max_value
    FROM public.clients c JOIN public.marchands m ON m.id = c.marchand_id
   WHERE c.deleted_at IS NULL
),
j AS (
  SELECT sc.stored_value_avant AS av, sc.stored_value_apres AS ap, sc.montant_credite,
         m.type_programme, m.max_value
    FROM public.scans sc JOIN public.marchands m ON m.id = sc.marchand_id
)
SELECT * FROM (
  SELECT 1 AS ordre, 'soldes négatifs' AS controle,
         (SELECT count(*) FROM cl WHERE stored_value < 0) AS nombre, '0' AS attendu,
         NULL::text AS detail
  UNION ALL
  SELECT 2, 'tampons : solde au-dessus du seuil',
         (SELECT count(*) FROM cl WHERE type_programme = 'stamps' AND stored_value > max_value), '0',
         (SELECT 'max ' || coalesce(max(stored_value)::text, '-')
            FROM cl WHERE type_programme = 'stamps' AND stored_value > max_value)
  UNION ALL
  SELECT 3, 'tampons : solde au seuil (récompense à remettre au prochain passage)',
         (SELECT count(*) FROM cl WHERE type_programme = 'stamps' AND stored_value = max_value), 'quelques-uns', NULL
  UNION ALL
  SELECT 4, 'points : solde au seuil ou au-dessus (récompense à remettre)',
         (SELECT count(*) FROM cl WHERE type_programme = 'points' AND stored_value >= max_value), 'quelques-uns',
         (SELECT 'plus haut : ' || coalesce(max(stored_value)::text, '-')
            FROM cl WHERE type_programme = 'points' AND stored_value >= max_value)
  UNION ALL
  SELECT 5, 'points : solde à deux fois le seuil ou plus',
         (SELECT count(*) FROM cl WHERE type_programme = 'points' AND stored_value >= 2 * max_value), '0', NULL
  UNION ALL
  SELECT 6, 'marchands dont le seuil est nul ou négatif',
         (SELECT count(*) FROM public.marchands WHERE max_value <= 0), '0', NULL
  UNION ALL
  SELECT 7, 'journal : lignes à solde négatif',
         (SELECT count(*) FROM j WHERE av < 0 OR ap < 0), '0', NULL
  UNION ALL
  SELECT 8, 'journal : scan hors remise dont (après − avant) ≠ montant crédité',
         (SELECT count(*) FROM j WHERE montant_credite IS NOT NULL AND av < max_value
                                    AND ap - av <> montant_credite), '0', NULL
  UNION ALL
  SELECT 9, 'journal tampons : scan hors remise dont le pas n''est pas +1',
         (SELECT count(*) FROM j WHERE type_programme = 'stamps' AND av < max_value AND ap - av <> 1), '0', NULL
  UNION ALL
  SELECT 10, 'journal : remise (avant ≥ seuil actuel) dont le résultat ne suit pas la règle',
         (SELECT count(*) FROM j WHERE av >= max_value AND montant_credite IS NOT NULL
                                    AND ap <> CASE WHEN type_programme = 'points'
                                                   THEN av - max_value + montant_credite ELSE 0 END), '0',
         'un écart peut venir d''un seuil modifié depuis'
  UNION ALL
  SELECT 11, 'journal : lignes antérieures aux colonnes de mesure (montant vide)',
         (SELECT count(*) FROM j WHERE montant_credite IS NULL), 'historique', NULL
) t
ORDER BY ordre;


-- ----------------------------------------------------------------------------
-- S7 — Chronométrer de vrais scans avec les horodatages que la base pose déjà
-- Un scan écrit trois fois, chaque écriture horodatée par la base elle-même
-- (même horloge, aucune dérive possible) :
--   (1) le solde : increment_stored_value met à jour clients, dont le
--       déclencheur pose updated_at (scan.js:121) ;
--   (2) la carte et (3) la ligne du journal, envoyées ensemble juste après la
--       réponse du crédit (scan.js:169-183) : passes.updated_at (déclencheur)
--       et scans.date_scan (valeur par défaut).
-- Pour le DERNIER scan de chaque client, quand rien n'a réécrit ni le client ni
-- la carte depuis, ces trois heures sont intactes :
--   solde_carte   = (2) − (1) : un aller-retour complet serveur ↔ base ;
--   solde_journal = (3) − (1) : idem pour l'autre écriture ;
--   journal_moins_carte = (3) − (2) : décalage entre les deux écritures parties
--     ensemble. Proche de 0 : les deux ont trouvé une connexion ouverte. Nettement
--     positif (ou négatif) : l'une a dû ouvrir une nouvelle connexion ; la
--     valeur mesure alors ce coût, que la caisse attend (elle attend les deux).
-- Tranches : temps écoulé depuis le scan précédent sur toute la plateforme
-- (plus il est long, plus les connexions ont pu se refermer).
-- Échantillon : 90 derniers jours. Les scans dont la carte a été réécrite après
-- (relance, campagne, avis) ou dont le client a été modifié sont écartés.
-- Attendu : quelques dizaines de scans au moins ; solde_carte_p50 proche des
-- 213 ms mesurées par 00a (§7.2) ; « 0. ensemble » = toutes tranches.
-- Au plus 5 lignes (une tranche sans scan n'apparaît pas).
-- ----------------------------------------------------------------------------
WITH tous AS (
  SELECT sc.id, sc.client_id, sc.date_scan, sc.annule_le,
         lag(sc.date_scan) OVER (ORDER BY sc.date_scan, sc.id)                     AS scan_precedent_plateforme,
         row_number() OVER (PARTITION BY sc.client_id
                            ORDER BY sc.date_scan DESC, sc.id DESC)                AS rang
    FROM public.scans sc
),
e AS (
  SELECT t.date_scan,
         coalesce(extract(epoch FROM t.date_scan - t.scan_precedent_plateforme), 1e9) AS inactivite_s,
         1000 * extract(epoch FROM p.updated_at  - c.updated_at)                   AS solde_vers_carte_ms,
         1000 * extract(epoch FROM t.date_scan   - c.updated_at)                   AS solde_vers_journal_ms,
         1000 * extract(epoch FROM t.date_scan   - p.updated_at)                   AS journal_moins_carte_ms
    FROM tous t
    JOIN public.clients c ON c.id = t.client_id
    JOIN public.passes  p ON p.serial_number = c.pass_serial_number
   WHERE t.rang = 1
     AND t.annule_le IS NULL
     AND t.date_scan >= now() - interval '90 days'
     AND c.updated_at BETWEEN t.date_scan - interval '10 seconds' AND t.date_scan
     AND p.updated_at BETWEEN t.date_scan - interval '10 seconds' AND t.date_scan + interval '10 seconds'
),
g AS (
  SELECT CASE WHEN inactivite_s < 5   THEN '1. moins de 5 s'
              WHEN inactivite_s < 60  THEN '2. de 5 s à 1 min'
              WHEN inactivite_s < 600 THEN '3. de 1 à 10 min'
              ELSE                         '4. 10 min et plus' END                AS tranche, e.*
    FROM e
)
SELECT coalesce(tranche, '0. ensemble')                                            AS inactivite_avant_le_scan,
       count(*)                                                                    AS scans,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY solde_vers_carte_ms))    AS solde_carte_p50_ms,
       round(percentile_cont(0.9) WITHIN GROUP (ORDER BY solde_vers_carte_ms))    AS solde_carte_p90_ms,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY solde_vers_journal_ms))  AS solde_journal_p50_ms,
       round(percentile_cont(0.9) WITHIN GROUP (ORDER BY solde_vers_journal_ms))  AS solde_journal_p90_ms,
       round(percentile_cont(0.1) WITHIN GROUP (ORDER BY journal_moins_carte_ms)) AS journal_moins_carte_p10_ms,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY journal_moins_carte_ms)) AS journal_moins_carte_p50_ms,
       round(percentile_cont(0.9) WITHIN GROUP (ORDER BY journal_moins_carte_ms)) AS journal_moins_carte_p90_ms,
       min(date_scan)::date                                                        AS du,
       max(date_scan)::date                                                        AS au
  FROM g
 GROUP BY ROLLUP (tranche)
 ORDER BY 1;


-- ----------------------------------------------------------------------------
-- C8 — Coupure du parrainage (décision de pilotage du 27/09)
-- Reprise telle quelle de docs/audit/00b-requetes.sql, non exécutée à ce jour.
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


-- ============================================================================
-- REQUÊTES DE SUIVI (facultatives) — ajoutées le 27/09 après lecture de S1 à S7
-- Même méthode : lecture seule, testées sur la base rejouée et le jeu fabriqué
-- (S1b 1/1, S1c 3/3 comptes, S5b conforme, S7b conforme, avec contrôle positif).
-- Chacune tranche une hypothèse du rapport 02 (numéro H entre parenthèses).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- S1b — Crédits en points de même montant, sur la même carte, à moins de 10 min
-- (rapport 02, H1). S1 en compte 21 (15 entre 10 et 60 s, 6 entre 1 et 10 min).
-- Chaque ligne est un double crédit possible, à confronter aux tickets de caisse
-- du marchand : la base seule ne distingue pas un renvoi de deux achats.
-- Attendu : au plus une vingtaine de lignes.
-- ----------------------------------------------------------------------------
WITH s AS (
  SELECT sc.client_id, sc.marchand_id, sc.date_scan, sc.montant_credite, sc.annule_le,
         sc.point_de_vente_id,
         lag(sc.date_scan)       OVER w AS p_date,
         lag(sc.montant_credite) OVER w AS p_montant,
         lag(sc.annule_le)       OVER w AS p_annule
    FROM public.scans sc
  WINDOW w AS (PARTITION BY sc.client_id ORDER BY sc.date_scan, sc.id)
)
SELECT s.date_scan::timestamp(0)                                  AS second_scan_le,
       m.nom                                                      AS marchand,
       left(s.client_id::text, 8)                                 AS client,
       s.montant_credite                                          AS montant,
       date_trunc('second', s.date_scan - s.p_date)               AS ecart,
       (s.annule_le IS NOT NULL OR s.p_annule IS NOT NULL)        AS une_annulee,
       (s.point_de_vente_id IS NOT NULL)                          AS jeton_boutique
  FROM s JOIN public.marchands m ON m.id = s.marchand_id
 WHERE m.type_programme = 'points'
   AND s.p_date IS NOT NULL
   AND s.date_scan - s.p_date < interval '10 minutes'
   AND s.montant_credite = s.p_montant
 ORDER BY s.date_scan;


-- ----------------------------------------------------------------------------
-- S1c — Paires de scans en tampons à moins de 10 s, avant et après les garde-fous
-- de la caisse (rapport 02, H2). Dates des commits : confirmation avant écriture
-- sur la caisse le 26/07 20:06 UTC (25cd3cf) ; verrou de carte, et confirmation
-- sur l'onglet scanner du dashboard, le 23/08 20:48 UTC (cddf79e). Avant ces
-- dates, la caméra pouvait réécrire la même carte (passation §2 [11]) ; après,
-- un second tampon demande un geste explicite (« ajouter un tampon »).
-- Attendu : 3 lignes au plus. Beaucoup de paires avant, peu après : les doublons
-- involontaires étaient réels.
-- ----------------------------------------------------------------------------
WITH s AS (
  SELECT sc.client_id, sc.marchand_id, sc.date_scan,
         lag(sc.date_scan) OVER (PARTITION BY sc.client_id ORDER BY sc.date_scan, sc.id) AS p_date
    FROM public.scans sc
)
SELECT CASE WHEN s.date_scan < timestamptz '2026-07-26 20:06:17+00' THEN '1. avant le 26/07 (aucune confirmation)'
            WHEN s.date_scan < timestamptz '2026-08-23 20:48:07+00' THEN '2. du 26/07 au 23/08 (confirmation sur la caisse seulement)'
            ELSE                                                          '3. après le 23/08 (confirmation et verrou partout)' END AS periode,
       count(*) FILTER (WHERE s.date_scan - s.p_date <  interval '10 seconds')           AS paires_moins_de_10_s,
       count(*) FILTER (WHERE s.date_scan - s.p_date >= interval '10 seconds')           AS autres_paires,
       count(DISTINCT s.marchand_id) FILTER (WHERE s.date_scan - s.p_date < interval '10 seconds') AS marchands
  FROM s JOIN public.marchands m ON m.id = s.marchand_id
 WHERE m.type_programme = 'stamps' AND s.p_date IS NOT NULL
 GROUP BY 1 ORDER BY 1;


-- ----------------------------------------------------------------------------
-- S5b — Les annulations laissent-elles une trace au registre ? (rapport 02, H3)
-- Chaque annulation relance la carte avec la source « annulation » (scan.js:408,
-- clients.js:242). S5 : 0 lot « annulation » au registre. Attendu : si
-- annulations_depuis_le_registre > 0, lots_annulation_au_registre du même ordre.
-- 1 ligne.
-- ----------------------------------------------------------------------------
SELECT (SELECT min(envoye_le) FROM public.notification_envois)::timestamp(0)                  AS registre_depuis,
       (SELECT count(*) FROM public.scans
         WHERE annule_le >= (SELECT min(envoye_le) FROM public.notification_envois))           AS annulations_depuis_le_registre,
       (SELECT count(DISTINCT lot) FROM public.notification_envois WHERE source = 'annulation') AS lots_annulation_au_registre,
       (SELECT count(*) FROM public.notification_envois WHERE source = 'welcome')              AS lignes_welcome_au_registre;


-- ----------------------------------------------------------------------------
-- S7b — La queue de S7 vient-elle de la poussée de bienvenue ? (rapport 02, H4)
-- S7 : pour au moins 10 % des scans, la carte est réécrite plus de 3 s après le
-- crédit, alors que 90 % des lignes de journal partent en moins de 0,6 s. Les deux
-- écritures partent ensemble : un retard réseau toucherait l'une ou l'autre au
-- hasard. Hypothèse : une autre écriture de la carte, la bienvenue envoyée à
-- l'installation (apple-wallet.js:58, :183-185), tombe juste après le premier
-- scan. Séparer le premier scan d'un client des scans suivants tranche.
-- Attendu : la queue (carte_ecrite_plus_de_2_s_apres) concentrée sur la ligne
-- « premier scan » ; sur « scan suivant », solde_carte_p90 proche de
-- solde_journal_p90. 2 lignes.
-- ----------------------------------------------------------------------------
WITH tous AS (
  SELECT sc.id, sc.client_id, sc.date_scan, sc.annule_le,
         row_number() OVER (PARTITION BY sc.client_id ORDER BY sc.date_scan DESC, sc.id DESC) AS rang,
         count(*)     OVER (PARTITION BY sc.client_id)                                        AS nb_scans
    FROM public.scans sc
),
e AS (
  SELECT CASE WHEN t.nb_scans = 1 THEN '1. premier scan du client (carte installée juste avant)'
              ELSE                     '2. scan suivant' END                                AS cas,
         1000 * extract(epoch FROM p.updated_at - c.updated_at)                            AS solde_vers_carte_ms,
         1000 * extract(epoch FROM t.date_scan  - c.updated_at)                            AS solde_vers_journal_ms
    FROM tous t
    JOIN public.clients c ON c.id = t.client_id
    JOIN public.passes  p ON p.serial_number = c.pass_serial_number
   WHERE t.rang = 1
     AND t.annule_le IS NULL
     AND t.date_scan >= now() - interval '90 days'
     AND c.updated_at BETWEEN t.date_scan - interval '10 seconds' AND t.date_scan
     AND p.updated_at BETWEEN t.date_scan - interval '10 seconds' AND t.date_scan + interval '10 seconds'
)
SELECT cas, count(*) AS scans,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY solde_vers_carte_ms))   AS solde_carte_p50_ms,
       round(percentile_cont(0.9) WITHIN GROUP (ORDER BY solde_vers_carte_ms))   AS solde_carte_p90_ms,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY solde_vers_journal_ms)) AS solde_journal_p50_ms,
       round(percentile_cont(0.9) WITHIN GROUP (ORDER BY solde_vers_journal_ms)) AS solde_journal_p90_ms,
       count(*) FILTER (WHERE solde_vers_carte_ms > 2000)                        AS carte_ecrite_plus_de_2_s_apres
  FROM e GROUP BY 1 ORDER BY 1;
