-- ============================================================================
-- Audit WinWin — segment 3 : accès et données — requêtes de mesure
-- ============================================================================
-- LECTURE SEULE. Aucune requête n'écrit, ne crée ni ne modifie quoi que ce soit.
-- À exécuter dans l'éditeur SQL Supabase, UNE requête à la fois (Q1 à Q5).
-- Pour chaque résultat : bouton « Copy » / export CSV, puis coller dans le fil.
--
-- Les résultats ne contiennent QUE des comptages, des noms de rôles/tables et
-- des métadonnées de schéma : aucune valeur personnelle, aucun numéro de série,
-- aucun e-mail, aucune adresse IP. Ils peuvent figurer tels quels dans un
-- rapport public.
--
-- Testées avant envoi sur une base rejouée depuis le dépôt (schema.sql +
-- migrations 002→047 + rgpd_effacement.sql, PostgreSQL 16 : 46 migrations,
-- 0 échec), avec les GRANT service_role des 7 tables centrales (00a §5.1) et
-- les rôles anon / authenticated / service_role / authenticator recréés comme
-- sur Supabase. Deux points délicats de Q2 vérifiés sur cette base :
--   • un appel réussi à une fonction SECURITY DEFINER est bien enregistré au
--     nom du rôle APPELANT (anon/authenticated), pas du propriétaire ;
--   • un appel qui échoue (identifiants invalides) n'est PAS enregistré.
-- Les requêtes qui visent des schémas propres à Supabase (storage, auth) ont
-- été validées sur des mocks de même forme.
--
-- Exécutées par Yass le 27/09 (résultats bruts : rapport 03, annexe A).
-- Chaque requête rend moins de 100 lignes (l'éditeur tronque au-delà sans le dire).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Q1 — Stockage des images : configuration du bucket « passes » + qui peut
-- y écrire. Le bucket public signifie que tout fichier est lisible par URL
-- (voulu : Apple et Google vont chercher les images). Le point à établir :
-- les droits de anon/authenticated sur storage.objects et le nombre de policies.
-- RLS active + 0 policy = refus par défaut pour les rôles non-BYPASSRLS : seul
-- le backend (service_role) écrit et liste, quels que soient les droits de table.
-- ----------------------------------------------------------------------------
SELECT 'bucket_passes_public' AS rubrique,
       coalesce((SELECT public::text FROM storage.buckets WHERE id='passes'),'(bucket absent)') AS valeur
UNION ALL SELECT 'bucket_passes_plafond_taille', coalesce((SELECT file_size_limit::text FROM storage.buckets WHERE id='passes'),'(aucun)')
UNION ALL SELECT 'bucket_passes_types_autorises', coalesce((SELECT array_to_string(allowed_mime_types,',') FROM storage.buckets WHERE id='passes'),'(tous)')
UNION ALL SELECT 'buckets_publics_total', (SELECT count(*)::text FROM storage.buckets WHERE public)
UNION ALL SELECT 'storage.objects_RLS_active', (SELECT relrowsecurity::text FROM pg_class WHERE oid='storage.objects'::regclass)
UNION ALL SELECT 'storage.objects_droits_anon', coalesce((SELECT string_agg(p.priv,',' ORDER BY p.ord) FROM (VALUES(1,'SELECT'),(2,'INSERT'),(3,'UPDATE'),(4,'DELETE')) p(ord,priv) WHERE has_table_privilege('anon','storage.objects',p.priv)),'(aucun)')
UNION ALL SELECT 'storage.objects_droits_authenticated', coalesce((SELECT string_agg(p.priv,',' ORDER BY p.ord) FROM (VALUES(1,'SELECT'),(2,'INSERT'),(3,'UPDATE'),(4,'DELETE')) p(ord,priv) WHERE has_table_privilege('authenticated','storage.objects',p.priv)),'(aucun)')
UNION ALL SELECT 'storage.objects_policies_nb', (SELECT count(*)::text FROM pg_policies WHERE schemaname='storage' AND tablename='objects');


-- ----------------------------------------------------------------------------
-- Q1b — Détail des policies de storage.objects (renvoie 0 ligne s'il n'y en a
-- pas). Dit QUI peut écrire/lister quand des policies existent.
-- ----------------------------------------------------------------------------
SELECT policyname, cmd, array_to_string(roles,',') AS roles,
       (qual ILIKE '%passes%' OR with_check ILIKE '%passes%') AS cible_bucket_passes
FROM pg_policies WHERE schemaname='storage' AND tablename='objects' ORDER BY policyname;


-- ----------------------------------------------------------------------------
-- Q2a — L'outil de mesure des requêtes est-il actif ?
-- Si valeur = false : NON VÉRIFIABLE, ne rien conclure sur l'usage passé.
-- ----------------------------------------------------------------------------
SELECT 'pg_stat_statements_installe' AS rubrique,
       (SELECT (count(*)>0)::text FROM pg_extension WHERE extname='pg_stat_statements') AS valeur;


-- ----------------------------------------------------------------------------
-- Q2b — Appels enregistrés par les rôles PUBLICS de l'API (anon = clé anon/
-- publishable ; authenticated = jeton utilisateur Supabase). À lancer seulement
-- si Q2a = true.
--   • Aucune ligne  → le canal public n'a rien exécuté avec succès sur la
--     fenêtre couverte (voir Q2c).
--   • appels_effacer_client > 0 → l'API publique a appelé effacer_client avec
--     succès (attribué au rôle appelant, vérifié).
-- Un 0 n'est PAS une preuve d'absence : un appel qui échoue n'est pas
-- enregistré, et pg_stat_statements plafonne (~5 000 entrées, éviction des
-- moins fréquentes). La diversité de requêtes de la plateforme est faible,
-- l'éviction d'une entrée reste donc peu probable.
-- ----------------------------------------------------------------------------
SELECT r.rolname AS role,
       count(*)                                                        AS entrees_distinctes,
       sum(s.calls)                                                    AS appels_totaux,
       coalesce(sum(s.calls) FILTER (WHERE s.query ILIKE '%effacer_client%'),0) AS appels_effacer_client
FROM pg_stat_statements s JOIN pg_roles r ON r.oid = s.userid
WHERE r.rolname IN ('anon','authenticated')
GROUP BY r.rolname ORDER BY r.rolname;


-- ----------------------------------------------------------------------------
-- Q2c — Depuis quand les statistiques courent (borne de la fenêtre de Q2b).
-- Plus stats_reset est récent, plus une absence pèse peu. À lancer si Q2a = true.
-- ----------------------------------------------------------------------------
SELECT stats_reset::text AS stats_reset FROM pg_stat_statements_info;


-- ----------------------------------------------------------------------------
-- Q3 — Rôles, connexions directes, temps réel, comptes Auth.
-- On cherche : si anon/authenticated héritent d'un rôle plus puissant (attendu
-- « rien ») ; quels rôles peuvent se connecter directement à la base ; quelles
-- tables sont exposées en temps réel (l'appli n'utilise pas le temps réel) ;
-- le NOMBRE de comptes Supabase Auth (l'appli n'utilise pas Supabase Auth).
-- ----------------------------------------------------------------------------
SELECT 'anon_herite_de' AS rubrique,
       coalesce((SELECT string_agg(g.rolname,',') FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.roleid JOIN pg_roles mem ON mem.oid=m.member WHERE mem.rolname='anon'),'(rien)') AS valeur
UNION ALL SELECT 'authenticated_herite_de', coalesce((SELECT string_agg(g.rolname,',') FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.roleid JOIN pg_roles mem ON mem.oid=m.member WHERE mem.rolname='authenticated'),'(rien)')
UNION ALL SELECT 'roles_login_nb', (SELECT count(*)::text FROM pg_roles WHERE rolcanlogin)
UNION ALL SELECT 'roles_login_noms', (SELECT string_agg(rolname,',' ORDER BY rolname) FROM pg_roles WHERE rolcanlogin)
UNION ALL SELECT 'tables_realtime_nb', coalesce((SELECT count(*)::text FROM pg_publication_tables WHERE pubname='supabase_realtime'),'0')
UNION ALL SELECT 'tables_realtime_noms', coalesce((SELECT string_agg(schemaname||'.'||tablename,',') FROM pg_publication_tables WHERE pubname='supabase_realtime'),'(aucune)')
UNION ALL SELECT 'comptes_auth_users_nb', (SELECT count(*)::text FROM auth.users);


-- ----------------------------------------------------------------------------
-- Q4 — Moyens de couper un accès, en service (comptages). Le jeton complet de
-- la caisse mono-site (cas c, passation §15 ter) est compté par
-- « marchands_mono_site_jeton_complet ». « boutiques_coupees_ou_archivees_avec_login »
-- : une coupure/archivage ne retire pas les identifiants scanner.
-- ----------------------------------------------------------------------------
SELECT 'boutiques_coupees_ou_archivees_avec_login' AS rubrique,
  (SELECT count(*) FROM points_de_vente WHERE scanner_login IS NOT NULL AND (actif=false OR deleted_at IS NOT NULL))::text AS valeur
UNION ALL SELECT 'marchands_suspendus', (SELECT count(*) FROM marchands WHERE actif=false)::text
UNION ALL SELECT 'marchands_sessions_revoquees_tv_sup_1', (SELECT count(*) FROM marchands WHERE token_version>1)::text
UNION ALL SELECT 'marchands_mono_site_jeton_complet',
  (SELECT count(*) FROM marchands m WHERE NOT EXISTS (SELECT 1 FROM points_de_vente p WHERE p.marchand_id=m.id AND p.deleted_at IS NULL AND p.scanner_login IS NOT NULL))::text
UNION ALL SELECT 'marchands_reseau_min_1_boutique',
  (SELECT count(*) FROM marchands m WHERE EXISTS (SELECT 1 FROM points_de_vente p WHERE p.marchand_id=m.id AND p.deleted_at IS NULL AND p.scanner_login IS NOT NULL))::text;


-- ----------------------------------------------------------------------------
-- Q5 — Données personnelles détenues (comptages). « non_proplus » : donnée
-- personnelle conservée chez un marchand qui n'est plus Pro+ (GET /api/clients
-- la renvoie toujours à tout jeton marchand).
-- ----------------------------------------------------------------------------
SELECT 'clients_avec_email' AS rubrique, (SELECT count(*) FROM clients WHERE email IS NOT NULL AND deleted_at IS NULL)::text AS valeur
UNION ALL SELECT 'clients_avec_telephone', (SELECT count(*) FROM clients WHERE telephone IS NOT NULL AND deleted_at IS NULL)::text
UNION ALL SELECT 'clients_avec_date_naissance', (SELECT count(*) FROM clients WHERE date_anniversaire IS NOT NULL AND deleted_at IS NULL)::text
UNION ALL SELECT 'clients_perso_chez_marchand_non_proplus',
  (SELECT count(*) FROM clients c JOIN marchands m ON m.id=c.marchand_id WHERE c.deleted_at IS NULL AND m.forfait<>'pro_plus' AND (c.email IS NOT NULL OR c.telephone IS NOT NULL OR c.date_anniversaire IS NOT NULL))::text
UNION ALL SELECT 'effacements_rgpd_total', (SELECT count(*) FROM clients WHERE deleted_at IS NOT NULL)::text;


-- ----------------------------------------------------------------------------
-- Q5b — Effacements RGPD par mois (mois + comptage, pas de valeur personnelle).
-- ----------------------------------------------------------------------------
SELECT to_char(date_trunc('month', deleted_at),'YYYY-MM') AS mois, count(*) AS effacements
FROM clients WHERE deleted_at IS NOT NULL GROUP BY 1 ORDER BY 1;
