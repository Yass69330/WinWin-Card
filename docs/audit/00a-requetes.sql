-- ============================================================================
-- Audit WinWin — étape préalable 00a : photographie du schéma de production
-- ============================================================================
-- LECTURE SEULE. Aucune requête n'écrit, ne crée ni ne modifie quoi que ce soit.
-- À exécuter dans l'éditeur SQL Supabase, UNE requête à la fois (P1 à P8).
-- Pour chaque résultat : bouton « Copy » / export CSV, puis coller dans le fil.
--
-- Principe : chaque objet du schéma public est réduit à une EMPREINTE (md5 d'une
-- description normalisée). Les mêmes requêtes ont été exécutées sur une base de
-- référence reconstruite à partir du dépôt (schema.sql + migrations 002→047 +
-- rgpd_effacement.sql, PostgreSQL 16). Deux empreintes identiques = objet
-- identique au dépôt. P7 et P8 sont les requêtes de détail, écrites APRÈS
-- lecture des résultats P1 à P6, sur les seuls objets divergents.
--
-- Normalisation : les préfixes « public. » et « extensions. » sont retirés
-- (sur Supabase, uuid-ossp vit dans le schéma extensions) ; l'ordre des
-- colonnes suit le NOM, pas la position physique (une colonne ajoutée à la main
-- dans un autre ordre n'est pas une divergence).
-- Chaque requête rend moins de 100 lignes (l'éditeur tronque au-delà sans le dire).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- P1 — Contexte : version, extensions, schémas, volumes d'objets
-- Attendu dépôt : public compte 14 tables, 0 vue, 7 fonctions hors extensions
-- (voir P1 de la référence dans 00a-photo.md).
-- ----------------------------------------------------------------------------
SELECT 'version' AS rubrique, current_setting('server_version') AS valeur
UNION ALL
SELECT 'extension', string_agg(e.extname || ' ' || e.extversion || ' @' || n.nspname, ', ' ORDER BY e.extname)
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
UNION ALL
SELECT 'schemas_non_systeme', string_agg(nspname, ', ' ORDER BY nspname)
  FROM pg_namespace
 WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema'
UNION ALL
SELECT 'public_tables', count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
UNION ALL
SELECT 'public_vues', count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('v','m')
UNION ALL
SELECT 'public_sequences', string_agg(c.relname, ', ' ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'S'
UNION ALL
-- Types personnalisés : enum (avec leurs valeurs, dans l'ordre), domaine (avec
-- son type de base), composite. Une seule ligne, quel que soit leur nombre.
SELECT 'public_types', coalesce(string_agg(
         t.typname || ':' || CASE t.typtype
           WHEN 'e' THEN 'enum(' || (SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
                                       FROM pg_enum e WHERE e.enumtypid = t.oid) || ')'
           WHEN 'd' THEN 'domaine(' || format_type(t.typbasetype, t.typtypmod) || ')'
           ELSE 'composite' END,
         ', ' ORDER BY t.typname), '(aucun)')
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
 WHERE n.nspname = 'public' AND t.typtype IN ('e','d','c')
   AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid AND c.relkind <> 'c')
UNION ALL
SELECT 'public_fonctions', count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
UNION ALL
SELECT 'public_triggers', count(*)::text FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal
UNION ALL
SELECT 'public_policies', count(*)::text FROM pg_policies WHERE schemaname = 'public';


-- ----------------------------------------------------------------------------
-- P2 — Empreinte par table : colonnes, contraintes, index, triggers, policies
-- Une ligne par table du schéma public. À comparer colonne à colonne avec la
-- référence. Une table présente d'un seul côté se voit immédiatement.
-- ----------------------------------------------------------------------------
WITH t AS (
  SELECT c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m')
),
norm AS (SELECT '\m(public|extensions)\.' AS rx)
SELECT t.relname AS table_,
       t.relkind AS type,
       t.relrowsecurity AS rls,
       (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped) AS n_col,
       left(md5((SELECT string_agg(a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull || '|'
                   || coalesce(regexp_replace(pg_get_expr(ad.adbin, ad.adrelid), (SELECT rx FROM norm), '', 'g'), '')
                   || '|' || a.attidentity::text || '|' || a.attgenerated::text, ';' ORDER BY a.attname)
                   FROM pg_attribute a LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
                  WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped)), 10) AS h_col,
       (SELECT count(*) FROM pg_constraint k WHERE k.conrelid = t.oid) AS n_cons,
       left(md5(coalesce((SELECT string_agg(k.conname || '|' || regexp_replace(pg_get_constraintdef(k.oid), (SELECT rx FROM norm), '', 'g'), ';' ORDER BY k.conname)
                   FROM pg_constraint k WHERE k.conrelid = t.oid), '')), 10) AS h_cons,
       (SELECT count(*) FROM pg_index i WHERE i.indrelid = t.oid) AS n_idx,
       left(md5(coalesce((SELECT string_agg(regexp_replace(pg_get_indexdef(i.indexrelid), (SELECT rx FROM norm), '', 'g'), ';' ORDER BY 1)
                   FROM pg_index i WHERE i.indrelid = t.oid), '')), 10) AS h_idx,
       (SELECT count(*) FROM pg_trigger g WHERE g.tgrelid = t.oid AND NOT g.tgisinternal) AS n_trg,
       left(md5(coalesce((SELECT string_agg(regexp_replace(pg_get_triggerdef(g.oid), (SELECT rx FROM norm), '', 'g'), ';' ORDER BY g.tgname)
                   FROM pg_trigger g WHERE g.tgrelid = t.oid AND NOT g.tgisinternal), '')), 10) AS h_trg,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.relname) AS n_pol,
       left(md5(coalesce((SELECT string_agg(p.policyname || '|' || p.cmd || '|' || p.permissive || '|' || array_to_string(p.roles, ',')
                   || '|' || coalesce(p.qual, '') || '|' || coalesce(p.with_check, ''), ';' ORDER BY p.policyname)
                   FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.relname), '')), 10) AS h_pol
  FROM t
 ORDER BY t.relname;


-- ----------------------------------------------------------------------------
-- P3 — Fonctions du schéma public : signatures et empreinte du corps
-- Une ligne par fonction (surcharges comprises : c'est ce qu'on cherche).
-- h_corps ignore tous les espaces et retours à la ligne ; h_corps_brut non.
-- Attendu dépôt : 7 fonctions, UNE seule increment_stored_value (4 arguments).
-- ----------------------------------------------------------------------------
SELECT p.proname AS fonction,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_function_result(p.oid) AS retour,
       l.lanname AS langage,
       p.prosecdef AS security_definer,
       p.provolatile AS volatilite,
       coalesce(array_to_string(p.proconfig, ','), '') AS config,
       left(md5(regexp_replace(p.prosrc, '\s+', '', 'g')), 10) AS h_corps,
       left(md5(p.prosrc), 10) AS h_corps_brut
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
 WHERE n.nspname = 'public'
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
 ORDER BY 1, 2;


-- ----------------------------------------------------------------------------
-- P4 — Droits sur les tables et les séquences (rôles exposés par l'API)
-- Une ligne par objet. Lettres : r=SELECT a=INSERT w=UPDATE d=DELETE
-- D=TRUNCATE x=REFERENCES t=TRIGGER U=USAGE. Vide = aucun droit.
-- Droits effectifs (directs, via PUBLIC ou par héritage de rôle).
-- Le dépôt ne déclare que des GRANT à service_role (et authenticated sur
-- notification_logs). Tout droit en plus vient des privilèges par défaut de
-- Supabase : ce n'est pas forcément une anomalie, mais c'est à photographier.
-- ----------------------------------------------------------------------------
WITH o AS (
  SELECT c.oid, c.relname, c.relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S')
),
d AS (
  SELECT o.relname, o.relkind, r.rolname,
         string_agg(pv.lettre, '' ORDER BY pv.ordre) AS droits
    FROM o
   CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
   CROSS JOIN (VALUES (1,'SELECT','r'), (2,'INSERT','a'), (3,'UPDATE','w'), (4,'DELETE','d'),
                      (5,'TRUNCATE','D'), (6,'REFERENCES','x'), (7,'TRIGGER','t'), (8,'USAGE','U')) AS pv(ordre, priv, lettre)
   WHERE CASE WHEN o.relkind = 'S'
              THEN pv.priv IN ('SELECT','UPDATE','USAGE') AND has_sequence_privilege(r.rolname, o.oid, pv.priv)
              ELSE pv.priv <> 'USAGE' AND has_table_privilege(r.rolname, o.oid, pv.priv) END
   GROUP BY o.relname, o.relkind, r.rolname
)
SELECT o.relname AS objet, o.relkind AS type,
       coalesce((SELECT droits FROM d WHERE d.relname = o.relname AND d.rolname = 'anon'), '')          AS anon,
       coalesce((SELECT droits FROM d WHERE d.relname = o.relname AND d.rolname = 'authenticated'), '') AS authenticated,
       coalesce((SELECT droits FROM d WHERE d.relname = o.relname AND d.rolname = 'service_role'), '')  AS service_role
  FROM o
 ORDER BY o.relkind, o.relname;


-- ----------------------------------------------------------------------------
-- P5 — Droit d'EXÉCUTION sur les fonctions + privilèges par défaut
-- Première partie : qui peut appeler chaque fonction (une ligne par fonction).
-- Seconde partie : les privilèges par défaut du schéma public (ce que reçoit
-- automatiquement toute table/fonction créée à l'avenir).
-- ----------------------------------------------------------------------------
SELECT 'fonction' AS genre,
       p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS objet,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role,
       NULL::text AS detail
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
UNION ALL
SELECT 'defaut_acl',
       pg_get_userbyid(d.defaclrole) || ' → ' || CASE d.defaclobjtype WHEN 'r' THEN 'tables' WHEN 'S' THEN 'sequences'
                                              WHEN 'f' THEN 'fonctions' WHEN 'T' THEN 'types' ELSE d.defaclobjtype::text END,
       NULL, NULL, NULL,
       array_to_string(d.defaclacl, ' ')
  FROM pg_default_acl d
 WHERE d.defaclnamespace = 'public'::regnamespace OR d.defaclnamespace = 0
 ORDER BY 1, 2;


-- ----------------------------------------------------------------------------
-- P6 — Réglages des rôles et stockage (hors dépôt, à photographier tel quel)
-- statement_timeout par rôle, réglages PostgREST éventuels, buckets Storage.
-- ----------------------------------------------------------------------------
SELECT 'role' AS genre, rolname AS nom, coalesce(array_to_string(rolconfig, ' ; '), '') AS valeur
  FROM pg_roles
 WHERE rolname IN ('anon','authenticated','service_role','authenticator','postgres')
UNION ALL
SELECT 'bucket', id, 'public=' || public || ' ; limite=' || coalesce(file_size_limit::text, '-')
  FROM storage.buckets
UNION ALL
SELECT 'reglage', name, setting || coalesce(' ' || unit, '')
  FROM pg_settings
 WHERE name IN ('max_connections','statement_timeout','idle_in_transaction_session_timeout','TimeZone','shared_buffers')
 ORDER BY 1, 2;

-- ----------------------------------------------------------------------------
-- P7 — Détail des 4 fonctions divergentes en P3, ligne à ligne
-- Compare le corps de production aux lignes du dépôt (empreintes md5 tronquées à
-- 8 caractères, calculées sur la base de référence, espaces ignorés, lignes vides
-- ignorées). Rend : une ligne de synthèse par fonction, les lignes de PRODUCTION
-- absentes du dépôt (texte intégral), les empreintes du DÉPÔT absentes de la
-- production (retraduites en texte dans 00a-photo.md). Comparaison ensembliste :
-- elle ne voit pas un changement d'ORDRE des lignes — d'où la preuve d'ordre
-- donnée dans 00a-photo.md §4.
-- ----------------------------------------------------------------------------
WITH ref(fonction, h) AS (
  SELECT 'annuler_scan', unnest('{7b820050,8cbf1e28,42566c4b,b9972fb9,94640731,19aad9f2,facebfaf,b184cfb9,89fcf305,d5a775e0,6931d0a4,4c400adf,cbf49bc3,6931d0a4,7d9f2794,9eeba01f,69fc69bc,89fcf305,9d37398d,6931d0a4,0c1aef89,2ea00ec7,396f24cc,8bd44561,49e63f92,c5a4cf14,7d990fd0,06836cdf,6931d0a4,74a70983,9446be00,f4346f13,ee573094,6931d0a4,2b3d5c26,ad8a0792,51f9bc36,f9e1801f,a2d035a6,f33eb166,20229467,82700691,616cc2f8,3450a923}'::text[])
  UNION ALL
  SELECT 'credit_referral', unnest('{7b820050,63429ae9,a0579fe6,3897c598,19aad9f2,98ce9415,1c9964bb,e6701ac0,1560e06e,0b54e2b9,9acf6aba,39540424,89fcf305,77136e0e,6931d0a4,09527106,f30bee53,a22b00a3,f33eb382,9443fced,7e3d97aa,3450a923}'::text[])
  UNION ALL
  SELECT 'effacer_client', unnest('{8d589afa,3242896a,73bc4504,13dbff43,8096aef7,1f10dfee,4c0c5c26,3606630d,2d84f087,fe486545,853cd504,c5a471b0,f3ca8c03,720af3a7,927b6e9b,065e48d4,f3ca8c03,720af3a7,395bf32e,e10e691c,f3ca8c03,720af3a7,25b02252,72faac9c,a0413eee,75039116,cb3385df,8440cc4e,b61a9b42,5fd4018f,31ad999d,cc50ed82,8096aef7,720af3a7,941a3516,986ac2f0,284daf78}'::text[])
  UNION ALL
  SELECT 'increment_stored_value', unnest('{7b820050,63429ae9,a0579fe6,fb2efacc,19aad9f2,0de1d58f,4244814d,27320a5b,b30d30b2,39540424,a202659c,6c963f1a,6931d0a4,5d02a640,9ce39b83,a0d189e2,e37c08d4,de40d7de,778537b0,fae79b19,6931d0a4,2cbf4b27,f6da7569,40c86fc5,dd037494,0165b3fc,1be5da13,6cce4472,778537b0,1be5da13,6931d0a4,08f6878b,6405b83c,3450a923}'::text[])
),
prod AS (
  SELECT p.proname AS fonction, l.n, l.t, left(md5(regexp_replace(l.t,'\s+','','g')),8) AS h
    FROM pg_proc p, regexp_split_to_table(p.prosrc, E'\n') WITH ORDINALITY l(t,n)
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('annuler_scan','credit_referral','effacer_client','increment_stored_value')
     AND regexp_replace(l.t,'\s+','','g') <> ''
)
SELECT '1_synthese' AS genre, f.fonction, NULL::bigint AS ligne,
       (SELECT count(*) FROM prod WHERE prod.fonction = f.fonction) || ' lignes prod / '
       || (SELECT count(*) FROM ref WHERE ref.fonction = f.fonction) || ' lignes dépôt' AS texte
  FROM (SELECT DISTINCT fonction FROM ref) f
UNION ALL
SELECT '2_prod_seulement', fonction, n, t
  FROM prod WHERE NOT EXISTS (SELECT 1 FROM ref WHERE ref.fonction = prod.fonction AND ref.h = prod.h)
UNION ALL
SELECT '3_depot_seulement', fonction, NULL, h
  FROM ref WHERE NOT EXISTS (SELECT 1 FROM prod WHERE prod.fonction = ref.fonction AND prod.h = ref.h)
ORDER BY 1, 2, 3;

-- ----------------------------------------------------------------------------
-- P8 — Déclencheurs d'événements (event triggers) et fonction rls_auto_enable
-- (absente du dépôt, apparue en P3). Rend les event triggers de la base, le
-- propriétaire de la fonction, puis sa définition, une ligne de code par ligne.
-- ----------------------------------------------------------------------------
SELECT '1_event_trigger' AS genre, NULL::bigint AS ligne,
       e.evtname || ' | evenement=' || e.evtevent || ' | actif=' || e.evtenabled::text
       || ' | fonction=' || e.evtfoid::regprocedure::text || ' | proprietaire=' || pg_get_userbyid(e.evtowner)
       || ' | tags=' || coalesce(array_to_string(e.evttags, ','), '(tous)') AS texte
  FROM pg_event_trigger e
UNION ALL
SELECT '2_proprietaire', NULL, pg_get_userbyid(p.proowner)
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'rls_auto_enable'
UNION ALL
SELECT '3_definition', l.n, l.t
  FROM pg_proc p, regexp_split_to_table(pg_get_functiondef(p.oid), E'\n') WITH ORDINALITY l(t, n)
 WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'rls_auto_enable'
ORDER BY 1, 2;
