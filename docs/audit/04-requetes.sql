-- ============================================================================
-- Audit WinWin — segment 4 : les cartes dans le téléphone — requêtes de mesure
-- ============================================================================
-- LECTURE SEULE. Aucune requête n'écrit, ne crée ni ne modifie quoi que ce soit.
-- À exécuter dans l'éditeur SQL Supabase, UNE requête à la fois (K1 à K4).
-- Pour chaque résultat : bouton « Copy » / export CSV, puis coller dans le fil.
--
-- Les résultats ne contiennent QUE des comptages, des durées, des noms de
-- marchands et des réglages de marchand : aucune donnée client, aucun numéro
-- de série, aucune adresse d'image, aucun texte de notification. Ils peuvent
-- figurer tels quels dans un rapport public.
--
-- Chaque requête rend moins de 100 lignes (l'éditeur tronque au-delà sans le
-- dire) : K1 31 lignes, K2 13 lignes, K3 une ligne par marchand (48 au 26/09),
-- K4 au plus 13 lignes plus une par marchand ayant des images générées.
--
-- Testées avant envoi sur une base rejouée depuis le dépôt (schema.sql +
-- migrations 002→047 + rgpd_effacement.sql, PostgreSQL 16 : 48 fichiers,
-- 0 échec), avec les GRANT service_role des 7 tables centrales (00a §5.1) et une
-- maquette de même forme de storage.objects pour K4 : d'abord à vide (aucune
-- erreur, résultats nuls), puis sur un jeu fabriqué dont chaque résultat était
-- connu d'avance (voir l'en-tête de chaque requête). Durée mesurée sur la même
-- base, avec un volume synthétique de la taille de la production puis dix fois
-- plus : K1 environ 3 s (dont environ 2,4 s de compilation JIT de PostgreSQL ;
-- 0,6 s sans), K2 à K4 moins de 1,5 s.
--
-- Convention : heures en UTC ; « carte iPhone » = carte dont au moins un
-- appareil Apple est enregistré aujourd'hui (device_tokens).
--
-- Exécutées par Yass le 27/09 : K1 à K4 (résultats bruts : rapport 04, annexe A).
-- En fin de fichier, K5 : requête de SUIVI facultative, ajoutée après lecture des
-- résultats, non exécutée ; elle trancherait un angle mort du rapport (§4.5).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- K1 — Les cartes que le cron réécrit à l'identique, et le parc iPhone
-- ----------------------------------------------------------------------------
-- Pourquoi : toute écriture sur `passes` avance `updated_at` (déclencheur
-- trg_passes_updated_at). Le cron réécrit le texte de la carte à chaque relance
-- (cron.js:237). Ce texte est constant pour un client qui ne revient pas :
-- relance = modèle du marchand + prénom + nom du marchand (cron.js:63-65) ;
-- boost = « plus que N » avec N inchangé tant que le solde ne bouge pas
-- (cron.js:130-131). Chaque réécriture est suivie d'une poussée : l'iPhone
-- revient chercher la carte, le serveur la régénère entièrement (3 requêtes,
-- images, signature, ≈ 100 Ko) alors qu'elle n'a pas changé.
--
-- Une exécution est comptée « à l'identique » quand l'écriture précédente sur
-- la même carte est une exécution du MÊME workflow, sans rien entre les deux qui
-- ait réécrit le texte de la carte : aucun scan ni annulation de scan du client,
-- aucune campagne du marchand, aucun crédit de parrainage reçu, aucun appareil
-- enregistré (bienvenue), et, depuis le 25/09 (registre), aucun ajustement,
-- annulation, avis, bienvenue, scan ni envoi manuel tracé sur la carte.
-- Limites (surestiment un peu « à l'identique ») : un ajustement antérieur au
-- 25/09, un changement du modèle de message, du prénom ou du design du
-- marchand entre deux relances ne laissent pas de trace datée. La première
-- exécution conservée d'un client (purge à 90 jours) n'est jamais comptée
-- identique (sous-estime un peu).
--
-- Lecture des colonnes : total, puis détail par workflow.
--   poussées Apple provoquées = une par appareil qui porte la carte ;
--   cartes revérifiées = pour chacun de ces appareils, toutes les cartes qu'il
--     porte (la liste « mises à jour depuis » renverrait tout : hypothèse forte,
--     rapport 01, cause C) : une seule est régénérée, les autres coûtent une
--     requête chacune (304).
--
-- Attendu sur le jeu fabriqué (4 marchands, 25 clients dont 1 effacé,
-- 27 exécutions, 5 appareils, 8 paires appareil × carte, 4 campagnes) :
--   parc : 24 cartes actives, 7 sur un iPhone, 5 appareils, 8 paires,
--          2 appareils multi-cartes, 3 cartes au plus sur un appareil,
--          4 scans sur 30 jours dont 2 sur une carte iPhone (5 cartes
--          revérifiées), plus ancienne exécution conservée il y a 30 jours ;
--   rétention  : exécutions 27 (21 / 5 / 1), à l'identique 6 (4 / 2 / 0),
--          identiques sur iPhone 4 (3 / 1 / 0), poussées 4 (3 / 1 / 0),
--          cartes revérifiées 9 (7 / 2 / 0), exécutions sur iPhone 11 (9 / 2 / 0),
--          jours avec exécution 21 (17 / 5 / 1) ;
--   7 derniers jours : 5 (4 / 0 / 1), 1 (1 / 0 / 0), 1, 1, 3, 2, 4 (4 / 0 / 1) ;
--   campagnes : 4, dont 1 au texte identique, 4 appareils poussés ;
--   bienvenues : registre tenu depuis 9 jours, 3 envoyées, 2 paires
--          carte × appareil, 1 réinscription.
-- ----------------------------------------------------------------------------
WITH
cartes AS (
  SELECT c.id AS client_id, c.pass_serial_number AS serial
    FROM public.clients c
   WHERE c.deleted_at IS NULL
),
appareils_par_carte AS (
  SELECT serial_number AS serial, count(*) AS n_app
    FROM public.device_tokens
   GROUP BY serial_number
),
cartes_par_appareil AS (
  SELECT device_id, count(*) AS n_cartes
    FROM public.device_tokens
   GROUP BY device_id
),
eventail AS (
  SELECT d.serial_number AS serial, sum(cpa.n_cartes) AS n_verif
    FROM public.device_tokens d
    JOIN cartes_par_appareil cpa USING (device_id)
   GROUP BY d.serial_number
),
ex AS (
  SELECT w.workflow_type AS t, w.client_id, w.marchand_id, w.executed_at AS ts,
         lag(w.workflow_type) OVER (PARTITION BY w.client_id ORDER BY w.executed_at) AS t_prec,
         lag(w.executed_at)   OVER (PARTITION BY w.client_id ORDER BY w.executed_at) AS ts_prec
    FROM public.workflow_executions w
),
qualif AS (
  SELECT ex.t, ex.ts,
         coalesce(a.n_app, 0)   AS n_app,
         coalesce(e.n_verif, 0) AS n_verif,
         ( coalesce(ex.t_prec = ex.t, false)
           AND NOT EXISTS (SELECT 1 FROM public.scans s
                            WHERE s.client_id = ex.client_id
                              AND (   (s.date_scan > ex.ts_prec AND s.date_scan < ex.ts)
                                   OR (s.annule_le > ex.ts_prec AND s.annule_le < ex.ts)))
           AND NOT EXISTS (SELECT 1 FROM public.notification_logs n
                            WHERE n.marchand_id = ex.marchand_id
                              AND n.created_at > ex.ts_prec AND n.created_at < ex.ts)
           AND NOT EXISTS (SELECT 1 FROM public.referral_credits r
                            WHERE r.parrain_client_id = ex.client_id
                              AND r.created_at > ex.ts_prec AND r.created_at < ex.ts)
           AND NOT EXISTS (SELECT 1 FROM public.device_tokens d
                            WHERE d.client_id = ex.client_id
                              AND d.created_at > ex.ts_prec AND d.created_at < ex.ts)
           AND NOT EXISTS (SELECT 1 FROM public.notification_envois ne
                            WHERE ne.serial_number = k.serial
                              AND ne.source IN ('ajustement','annulation','avis','welcome','scan','manuel')
                              AND ne.envoye_le > ex.ts_prec AND ne.envoye_le < ex.ts)
         ) AS identique
    FROM ex
    LEFT JOIN cartes k              ON k.client_id = ex.client_id
    LEFT JOIN appareils_par_carte a ON a.serial = k.serial
    LEFT JOIN eventail e            ON e.serial = k.serial
),
periodes(p, periode) AS (VALUES
  (1, 'cron, toute la rétention (90 j au plus)'),
  (2, 'cron, 7 derniers jours')
),
types(t) AS (VALUES ('total'), ('inactive'), ('near_reward'), ('birthday')),
per AS (
  SELECT 1 AS p, q.* FROM qualif q
  UNION ALL
  SELECT 2, q.* FROM qualif q WHERE q.ts >= now() - interval '7 days'
),
agg AS (
  SELECT p, coalesce(t, 'total') AS t,
         count(*)                                           AS execs,
         count(*) FILTER (WHERE identique)                  AS ident,
         count(*) FILTER (WHERE identique AND n_app > 0)    AS ident_iphone,
         coalesce(sum(n_app)   FILTER (WHERE identique), 0) AS poussees,
         coalesce(sum(n_verif) FILTER (WHERE identique), 0) AS verifs,
         count(*) FILTER (WHERE n_app > 0)                  AS execs_iphone,
         count(DISTINCT (ts AT TIME ZONE 'UTC')::date)      AS jours
    FROM per
   GROUP BY GROUPING SETS ((p, t), (p))
),
long AS (
  -- Grille fixe (2 périodes × 7 rubriques × 4 colonnes) : les lignes du cron
  -- s'affichent même à zéro.
  SELECT pr.p, pr.periode, v.o, v.rubrique, ty.t, v.val
    FROM periodes pr
    CROSS JOIN types ty
    LEFT JOIN agg ON agg.p = pr.p AND agg.t = ty.t
    CROSS JOIN LATERAL (VALUES
      (1, 'exécutions',                                          coalesce(agg.execs, 0)),
      (2, 'dont réécriture à l''identique',                      coalesce(agg.ident, 0)),
      (3, 'dont identiques sur une carte iPhone',                coalesce(agg.ident_iphone, 0)),
      (4, 'poussées Apple provoquées par les identiques',        coalesce(agg.poussees, 0)),
      (5, 'cartes revérifiées par ces appareils',                coalesce(agg.verifs, 0)),
      (6, 'exécutions sur une carte iPhone (identiques ou non)', coalesce(agg.execs_iphone, 0)),
      (7, 'jours avec au moins une exécution',                   coalesce(agg.jours, 0))
    ) AS v(o, rubrique, val)
),
camp AS (
  SELECT n.total_apple,
         n.message = lag(n.message) OVER (PARTITION BY n.marchand_id ORDER BY n.created_at) AS meme_texte
    FROM public.notification_logs n
),
bienv AS (
  SELECT serial_number, token_hash, count(*) AS n
    FROM public.notification_envois
   WHERE source = 'welcome' AND plateforme = 'apple'
   GROUP BY serial_number, token_hash
),
lignes AS (
  SELECT 0 AS o1, 1 AS o2, 'parc' AS section, 'cartes actives (clients non effacés)' AS rubrique,
         (SELECT count(*) FROM cartes)::text AS total,
         NULL::text AS inactive, NULL::text AS near_reward, NULL::text AS birthday
  UNION ALL SELECT 0, 2, 'parc', 'cartes présentes sur au moins un iPhone',
         (SELECT count(DISTINCT d.serial_number) FROM public.device_tokens d JOIN cartes k ON k.serial = d.serial_number)::text, NULL, NULL, NULL
  UNION ALL SELECT 0, 3, 'parc', 'appareils iPhone', (SELECT count(*) FROM cartes_par_appareil)::text, NULL, NULL, NULL
  UNION ALL SELECT 0, 4, 'parc', 'paires appareil × carte', (SELECT count(*) FROM public.device_tokens)::text, NULL, NULL, NULL
  UNION ALL SELECT 0, 5, 'parc', 'appareils portant plusieurs cartes', (SELECT count(*) FROM cartes_par_appareil WHERE n_cartes > 1)::text, NULL, NULL, NULL
  UNION ALL SELECT 0, 6, 'parc', 'cartes au plus sur un même appareil', (SELECT coalesce(max(n_cartes), 0) FROM cartes_par_appareil)::text, NULL, NULL, NULL
  UNION ALL SELECT 0, 8, 'parc', 'scans des 30 derniers jours (annulés compris)',
         (SELECT count(*) FROM public.scans WHERE date_scan >= now() - interval '30 days')::text, NULL, NULL, NULL
  UNION ALL SELECT 0, 9, 'parc', 'dont scans sur une carte iPhone',
         (SELECT count(*) FROM public.scans s JOIN cartes k ON k.client_id = s.client_id
            JOIN appareils_par_carte a ON a.serial = k.serial
           WHERE s.date_scan >= now() - interval '30 days')::text, NULL, NULL, NULL
  UNION ALL SELECT 0, 10, 'parc', 'cartes revérifiées par les appareils de ces scans',
         (SELECT coalesce(sum(e.n_verif), 0) FROM public.scans s JOIN cartes k ON k.client_id = s.client_id
            JOIN eventail e ON e.serial = k.serial
           WHERE s.date_scan >= now() - interval '30 days')::text, NULL, NULL, NULL
  UNION ALL SELECT 0, 11, 'parc', 'plus ancienne exécution du cron conservée (date)',
         (SELECT min(executed_at AT TIME ZONE 'UTC')::date FROM public.workflow_executions)::text, NULL, NULL, NULL
  UNION ALL
  SELECT l.p, l.o, l.periode, l.rubrique,
         max(l.val) FILTER (WHERE l.t = 'total')::text,
         max(l.val) FILTER (WHERE l.t = 'inactive')::text,
         max(l.val) FILTER (WHERE l.t = 'near_reward')::text,
         max(l.val) FILTER (WHERE l.t = 'birthday')::text
    FROM long l
   GROUP BY l.p, l.o, l.periode, l.rubrique
  UNION ALL SELECT 3, 1, 'campagnes', 'campagnes manuelles enregistrées', (SELECT count(*) FROM camp)::text, NULL, NULL, NULL
  UNION ALL SELECT 3, 2, 'campagnes', 'dont texte identique à la campagne précédente du même marchand',
         (SELECT count(*) FROM camp WHERE meme_texte)::text, NULL, NULL, NULL
  UNION ALL SELECT 3, 3, 'campagnes', 'appareils poussés par ces campagnes identiques',
         (SELECT coalesce(sum(total_apple), 0) FROM camp WHERE meme_texte)::text, NULL, NULL, NULL
  UNION ALL SELECT 4, 1, 'bienvenues (registre)', 'registre des envois tenu depuis (date)',
         (SELECT min(envoye_le AT TIME ZONE 'UTC')::date FROM public.notification_envois)::text, NULL, NULL, NULL
  UNION ALL SELECT 4, 2, 'bienvenues (registre)', 'bienvenues Apple envoyées', (SELECT coalesce(sum(n), 0) FROM bienv)::text, NULL, NULL, NULL
  UNION ALL SELECT 4, 3, 'bienvenues (registre)', 'paires carte × appareil distinctes', (SELECT count(*) FROM bienv)::text, NULL, NULL, NULL
  UNION ALL SELECT 4, 4, 'bienvenues (registre)', 'réinscriptions (bienvenue répétée, même carte, même appareil)',
         (SELECT coalesce(sum(n - 1), 0) FROM bienv)::text, NULL, NULL, NULL
)
SELECT section, rubrique, total, inactive, near_reward, birthday
  FROM lignes
 ORDER BY o1, o2;


-- ----------------------------------------------------------------------------
-- K2 — Combien de temps l'inscription attend Google (y compris pour un iPhone)
-- ----------------------------------------------------------------------------
-- Pourquoi : l'inscription (clients.js:23-95) écrit le client, puis la carte,
-- puis appelle Google 2 à 4 fois l'un après l'autre, sans délai maximal, pour
-- créer l'objet Google (google-pass.js:367-392), écrit le lien Google sur la
-- carte (clients.js:83), et seulement ensuite répond à la landing. Un client
-- iPhone attend donc Google pour recevoir le bouton de sa carte Apple.
-- La base date elle-même trois moments (même horloge, aucune dérive) :
--   clients.created_at  : écriture du client ;
--   passes.created_at   : écriture de la carte, juste après (un aller-retour) ;
--   passes.updated_at   : écriture du lien Google, après les appels à Google —
--     À CONDITION que rien n'ait réécrit la carte depuis.
-- On ne garde donc que les cartes jamais réécrites depuis l'inscription : aucun
-- scan, aucun appareil Apple enregistré (bienvenue), aucune relance du cron,
-- aucune ligne au registre, et un écart inférieur à 30 s (une campagne ou une
-- bienvenue d'un appareil depuis retiré tomberait bien plus tard, ou dans la
-- dernière tranche). Échantillon biaisé vers les inscriptions sans suite :
-- sans effet attendu sur la durée des appels à Google.
--   carte → lien Google ≈ appels à Google + un aller-retour avec la base ;
--   client → carte      ≈ un aller-retour avec la base (étalon).
-- Attendu sur le jeu fabriqué : 24 cartes au total, 7 retenues (3 écartées :
-- 45 s, un scan, une ligne de registre) ; carte → lien Google : médiane
-- 1 300 ms, p90 6 360 ms, max 12 000 ms ; client → carte : 200 ms ; tranches
-- 1 / 1 / 3 / 1 / 0 / 0 / 1 ; sur 30 jours : 6 cartes, médiane 1 500 ms,
-- p90 7 300 ms, max 12 000 ms.
-- ----------------------------------------------------------------------------
WITH e AS (
  SELECT extract(epoch FROM (p.updated_at - p.created_at)) * 1000 AS ms_google,
         extract(epoch FROM (p.created_at - c.created_at)) * 1000 AS ms_base,
         p.created_at
    FROM public.passes p
    JOIN public.clients c ON c.id = p.client_id
   WHERE p.google_pass_url IS NOT NULL
     AND p.updated_at >= p.created_at
     AND p.updated_at - p.created_at < interval '30 seconds'
     AND NOT EXISTS (SELECT 1 FROM public.scans s               WHERE s.client_id = p.client_id)
     AND NOT EXISTS (SELECT 1 FROM public.device_tokens d       WHERE d.serial_number = p.serial_number)
     AND NOT EXISTS (SELECT 1 FROM public.workflow_executions w WHERE w.client_id = p.client_id)
     AND NOT EXISTS (SELECT 1 FROM public.notification_envois n WHERE n.serial_number = p.serial_number)
),
tranches(o, libelle, bas, haut) AS (VALUES
  (1, 'tranche : moins de 0,5 s', 0, 500), (2, 'tranche : 0,5 à 1 s', 500, 1000),
  (3, 'tranche : 1 à 2 s', 1000, 2000),    (4, 'tranche : 2 à 3 s', 2000, 3000),
  (5, 'tranche : 3 à 5 s', 3000, 5000),    (6, 'tranche : 5 à 10 s', 5000, 10000),
  (7, 'tranche : 10 à 30 s', 10000, 30000)
)
SELECT rubrique, cartes, p50_ms, p90_ms, max_ms FROM (
  SELECT 1 AS o, 'cartes au total' AS rubrique, (SELECT count(*) FROM public.passes) AS cartes,
         NULL::int AS p50_ms, NULL::int AS p90_ms, NULL::int AS max_ms
  UNION ALL
  SELECT 2, 'cartes retenues (jamais réécrites depuis l''inscription)', count(*), NULL, NULL, NULL FROM e
  UNION ALL
  SELECT 3, 'carte → lien Google (appels Google + un aller-retour base)', count(*),
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ms_google))::int,
         round(percentile_cont(0.9) WITHIN GROUP (ORDER BY ms_google))::int,
         round(max(ms_google))::int FROM e
  UNION ALL
  SELECT 4, 'client → carte (un aller-retour base, étalon)', count(*),
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ms_base))::int,
         round(percentile_cont(0.9) WITHIN GROUP (ORDER BY ms_base))::int,
         round(max(ms_base))::int FROM e
  UNION ALL
  SELECT 4 + t.o, t.libelle, count(e.ms_google), NULL, NULL, NULL
    FROM tranches t
    LEFT JOIN e ON e.ms_google >= t.bas AND e.ms_google < t.haut
   GROUP BY t.o, t.libelle
  UNION ALL
  SELECT 12, 'carte → lien Google, inscriptions des 30 derniers jours', count(*),
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ms_google))::int,
         round(percentile_cont(0.9) WITHIN GROUP (ORDER BY ms_google))::int,
         round(max(ms_google))::int
    FROM e WHERE e.created_at >= now() - interval '30 days'
  UNION ALL
  SELECT 13, 'client → carte, inscriptions des 30 derniers jours', count(*),
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ms_base))::int,
         round(percentile_cont(0.9) WITHIN GROUP (ORDER BY ms_base))::int,
         round(max(ms_base))::int
    FROM e WHERE e.created_at >= now() - interval '30 days'
) r
ORDER BY o;


-- ----------------------------------------------------------------------------
-- K3 — La configuration des cartes, marchand par marchand
-- ----------------------------------------------------------------------------
-- Pourquoi : dire, pour chaque marchand, ce que ses cartes affichent et d'où
-- vient chaque élément. Aucune donnée client : des réglages et des comptages.
--   seuil_affiche      : display_max_value, seulement s'il diffère du seuil ;
--   bandeau / theme    : strip_mode (stamps, points_bar, vide = pas d'image
--                        générée) et strip_theme ;
--   paliers            : nombre d'images par palier (images_tiers) ;
--   image_fixe         : image de bandeau déposée (image_strip_url) ;
--   hero_google        : image propre à Google (google_hero_url) ;
--   version_images     : strip_config_version, avancée à chaque enregistrement
--                        de la fiche dans l'admin et à chaque dépôt de palier ;
--   filleuls_lies      : clients rattachés à un parrain = preuve que le
--                        parrainage a été actif chez ce marchand ;
--   cartes_avant_27_09 : cartes créées avant la coupure du parrainage (leur
--                        objet Google garde le texte posé à la création) ;
--   iphone_non_reecrites_depuis_27_09 : cartes iPhone dont la ligne n'a pas été
--                        réécrite depuis le 27/09 00:00 UTC (leur dernière
--                        version téléchargée date d'avant la coupure) ;
--   cartes_creees_30j, scans_30j : l'activité des 30 derniers jours.
-- Attendu sur le jeu fabriqué (4 lignes, dans cet ordre) :
--   Fixe Test : basic, stamps, 10, —, bandeau vide / icon_metier, 0 palier,
--     image fixe oui, hero Google oui, le reste non, version 1,
--     9 cartes, 0 iPhone, 8 avant le 27/09, 0, 8 créées sur 30 j, 1 scan ;
--   Tampons Test : pro, stamps, 10, —, stamps / icon_metier, 0 palier, non,
--     non, non, non, non, 0 filleul, version 7, relance oui, boost oui,
--     9 cartes, 4 iPhone, 9 avant le 27/09, 2 iPhone non réécrites, 0, 2 ;
--   Points Test : pro_plus, points, 500, 400, points_bar / icon_metier,
--     2 paliers, non, non, fond oui, avis oui, parrainage oui, 1 filleul,
--     version 3, relance non, boost non, 5 cartes, 2 iPhone, 5, 1, 1, 1 ;
--   Campagne Test : pro, 1 carte, 1 iPhone, 1, 1, 0, 0.
-- ----------------------------------------------------------------------------
WITH cartes AS (
  SELECT p.marchand_id, p.created_at, p.updated_at,
         EXISTS (SELECT 1 FROM public.device_tokens d WHERE d.serial_number = p.serial_number) AS iphone
    FROM public.passes p
    JOIN public.clients c ON c.id = p.client_id AND c.deleted_at IS NULL
),
par_m AS (
  SELECT marchand_id,
         count(*)                                                        AS cartes,
         count(*) FILTER (WHERE iphone)                                  AS cartes_iphone,
         count(*) FILTER (WHERE created_at < '2026-09-27 00:00:00+00')   AS avant,
         count(*) FILTER (WHERE iphone
                            AND updated_at < '2026-09-27 00:00:00+00')   AS iphone_anciennes,
         count(*) FILTER (WHERE created_at >= now() - interval '30 days') AS cartes_30j
    FROM cartes
   GROUP BY marchand_id
),
scans_m AS (
  SELECT marchand_id, count(*) AS n
    FROM public.scans
   WHERE date_scan >= now() - interval '30 days'
   GROUP BY marchand_id
),
filleuls AS (
  SELECT marchand_id, count(*) AS n
    FROM public.clients
   WHERE referred_by_client_id IS NOT NULL
   GROUP BY marchand_id
)
SELECT m.nom,
       m.actif,
       m.forfait,
       m.type_programme                                      AS programme,
       m.max_value                                           AS seuil,
       NULLIF(m.display_max_value, m.max_value)              AS seuil_affiche,
       m.strip_mode                                          AS bandeau,
       m.strip_theme                                         AS theme,
       CASE WHEN jsonb_typeof(m.images_tiers) = 'array'
            THEN jsonb_array_length(m.images_tiers) ELSE 0 END AS paliers,
       (m.image_strip_url IS NOT NULL)                       AS image_fixe,
       (m.google_hero_url IS NOT NULL)                       AS hero_google,
       (m.couleur_fond_reward IS NOT NULL)                   AS fond_recompense,
       (coalesce(m.lien_avis_google, '') <> '')              AS lien_avis,
       m.referral_enabled                                    AS parrainage,
       coalesce(f.n, 0)                                      AS filleuls_lies,
       m.strip_config_version                                AS version_images,
       m.workflow_inactive_enabled                           AS relance,
       m.workflow_near_reward_enabled                        AS boost,
       coalesce(pm.cartes, 0)                                AS cartes,
       coalesce(pm.cartes_iphone, 0)                         AS cartes_iphone,
       coalesce(pm.avant, 0)                                 AS cartes_avant_27_09,
       coalesce(pm.iphone_anciennes, 0)                      AS iphone_non_reecrites_depuis_27_09,
       coalesce(pm.cartes_30j, 0)                            AS cartes_creees_30j,
       coalesce(sm.n, 0)                                     AS scans_30j
  FROM public.marchands m
  LEFT JOIN par_m pm   ON pm.marchand_id = m.id
  LEFT JOIN filleuls f ON f.marchand_id  = m.id
  LEFT JOIN scans_m sm ON sm.marchand_id = m.id
 ORDER BY coalesce(pm.cartes, 0) DESC, m.nom;


-- ----------------------------------------------------------------------------
-- K4 — Les images des cartes dans le stockage (bucket « passes »)
-- ----------------------------------------------------------------------------
-- Pourquoi : les images de bandeau générées sont rangées par marchand, par
-- version (strip_config_version) et par valeur de solde, en trois variantes
-- (strip2x et strip3x pour Apple, hero pour Google) : strip-cache.js:30-51.
-- Une version remplacée est purgée au premier rendu de la nouvelle
-- (strip-cache.js:81-124). La taille d'une image « hero » est ce que chaque
-- mise à jour Google télécharge en entier pour vérifier qu'elle existe
-- (strip-cache.js:214). Aucun nom de fichier ni aucune adresse n'est rendu :
-- seulement des catégories, des tailles et des noms de marchands.
--   section 1 : par catégorie de fichier ;
--   section 2 : images générées, par état de version et par variante ;
--   section 3 : images générées, par marchand : versions présentes, valeurs de
--               solde rendues dans la version courante, fichiers d'anciennes
--               versions encore présents.
-- Attendu sur le jeu fabriqué :
--   section 1 : générées 25 fichiers (0,83 Mo), par palier 2 (0,2 Mo),
--               fixe 1 (0,2 Mo), autre 1 (0,01 Mo) ;
--   section 2 : version courante, par variante : 7 fichiers chacune
--               (hero 33,1 Ko en moyenne, 40 max ; strip2x 24,3 / 30 ;
--               strip3x 41,4 / 50) ; version ancienne : 1 par variante ;
--               marchand introuvable : 1 hero ;
--   section 3 : Tampons Test 12 fichiers, 2 versions, 3 valeurs, 3 anciens ;
--               Points Test 12 fichiers, 1 version, 4 valeurs, 0 ancien ;
--               (marchand introuvable) 1 fichier.
-- ----------------------------------------------------------------------------
WITH f AS (
  SELECT coalesce((o.metadata->>'size')::bigint, 0) AS octets,
         o.created_at,
         split_part(o.name, '/', 2) AS slug,
         CASE WHEN o.name ~ '^marchands/[^/]+/gen/v[0-9]+/'              THEN 'image générée'
              WHEN o.name ~ '^marchands/[^/]+/strip_tier_[0-9]+\.png$'   THEN 'image par palier (déposée)'
              WHEN o.name ~ '^marchands/[^/]+/strip_static\.png$'        THEN 'image fixe (déposée)'
              ELSE 'autre fichier' END AS categorie,
         substring(o.name FROM '/gen/v([0-9]+)/')::int AS version,
         substring(o.name FROM '_(strip2x|strip3x|hero)\.png$') AS variante,
         substring(o.name FROM '/gen/v[0-9]+/(.+)_(?:strip2x|strip3x|hero)\.png$') AS valeur
    FROM storage.objects o
   WHERE o.bucket_id = 'passes'
),
g AS (
  SELECT f.*, m.nom,
         CASE WHEN m.id IS NULL                                    THEN 'marchand introuvable'
              WHEN f.version = coalesce(m.strip_config_version, 1) THEN 'version courante'
              ELSE 'version ancienne' END AS etat
    FROM f
    LEFT JOIN public.marchands m ON m.slug = f.slug
   WHERE f.categorie = 'image générée'
)
SELECT section, cle, fichiers, mo, ko_moyen, ko_max, versions_presentes, valeurs_rendues, fichiers_anciens, plus_ancien
FROM (
  SELECT 1 AS o, 'par catégorie' AS section, categorie AS cle, count(*) AS fichiers,
         round(sum(octets) / 1048576.0, 2) AS mo, round(avg(octets) / 1024.0, 1) AS ko_moyen,
         round(max(octets) / 1024.0, 1) AS ko_max,
         NULL::bigint AS versions_presentes, NULL::bigint AS valeurs_rendues, NULL::bigint AS fichiers_anciens,
         min(created_at AT TIME ZONE 'UTC')::date AS plus_ancien
    FROM f GROUP BY categorie
  UNION ALL
  SELECT 2, 'générées : ' || etat, variante, count(*),
         round(sum(octets) / 1048576.0, 2), round(avg(octets) / 1024.0, 1), round(max(octets) / 1024.0, 1),
         NULL, NULL, NULL, min(created_at AT TIME ZONE 'UTC')::date
    FROM g GROUP BY etat, variante
  UNION ALL
  SELECT 3, 'générées, par marchand', coalesce(nom, '(marchand introuvable)'), count(*),
         round(sum(octets) / 1048576.0, 2), round(avg(octets) / 1024.0, 1), NULL,
         count(DISTINCT version),
         count(DISTINCT valeur) FILTER (WHERE etat = 'version courante'),
         count(*) FILTER (WHERE etat = 'version ancienne'),
         min(created_at AT TIME ZONE 'UTC')::date
    FROM g GROUP BY nom
) r
ORDER BY o, section, cle;


-- ----------------------------------------------------------------------------
-- K5 (SUIVI, facultative) — Les appels Google refusés, par surface
-- ----------------------------------------------------------------------------
-- Pourquoi : une carte Google porte au plus 10 messages (définition officielle
-- de l'API, champ `messages`), et le code en ajoute un à chaque scan, relance,
-- campagne, avis ou ajustement, sans date de fin (google-pass.js:499-525).
-- Ce que fait Google au-delà de 10 n'est pas documenté. Si Google refuse, les
-- ajouts de message suivants échouent : le registre les garde avec leur statut.
-- Les surfaces relance, boost, anniversaire, avis et envoi manuel ne font QUE
-- des ajouts de message ; scan, ajustement et annulation font une mise à jour
-- puis un ajout (deux lignes indiscernables).
-- Le texte d'erreur (colonne reason) n'est JAMAIS rendu : il peut contenir
-- l'identifiant de l'objet Google, donc le numéro de série. Seul un indicateur
-- dit s'il évoque un plafond (« too many », « maximum », « limit », « exceed »).
-- Attendu sur le jeu fabriqué : 6 lignes ; inactive 200 (1) et 400 (1, motif
-- plafond 1) ; manuel 200 (1) ; scan 200 (1), 404 (1), sans réponse (1).
-- Lecture en production : aucune ligne 4xx sur les surfaces « ajout de message
-- seul » → Google accepte au-delà de 10 (ou aucune carte n'y est encore) ; des
-- 400 avec motif plafond → le plafond coupe déjà des notifications Android.
-- ----------------------------------------------------------------------------
SELECT source,
       CASE WHEN source IN ('inactive','near_reward','birthday','avis','manuel')
            THEN 'ajout de message seul' ELSE 'mise à jour + ajout de message' END AS appels_google,
       coalesce(statut::text, 'sans réponse') AS statut,
       count(*)                                                        AS envois,
       count(DISTINCT serial_number)                                   AS cartes,
       count(*) FILTER (WHERE reason ~* '(too many|maximum|limit|exceed)') AS motif_evoque_un_plafond,
       min(envoye_le AT TIME ZONE 'UTC')::date                          AS premier,
       max(envoye_le AT TIME ZONE 'UTC')::date                          AS dernier
  FROM public.notification_envois
 WHERE plateforme = 'google'
 GROUP BY 1, 2, 3
 ORDER BY 1, 3;
