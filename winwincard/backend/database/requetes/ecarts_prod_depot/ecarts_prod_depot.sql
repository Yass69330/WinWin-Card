-- ============================================================================
-- Écarts entre une base réelle et le dépôt — généré par generer.sh, NE PAS
-- MODIFIER À LA MAIN (relancer generer.sh après chaque migration).
-- ============================================================================
-- LECTURE SEULE. N'écrit, ne crée, ne modifie rien. À coller en entier dans le
-- SQL Editor de Supabase, puis « Run ». Moins de 40 lignes rendues.
--
-- État du dépôt figé ci-dessous (VALUES « depot ») : base rejouée depuis le
-- dépôt, 51 fichiers (schema.sql, migrations jusqu'à
-- migration_051_credit_incassable.sql, rgpd_effacement.sql), PostgreSQL local.
-- La requête photographie la base où elle tourne et ne rend que les ÉCARTS :
--   plateforme : TRUNCATE / REFERENCES / TRIGGER hérités des privilèges par
--                défaut de Supabase — non consignés, décision du 2026-09-29 ;
--   ECART      : tout le reste → la base diffère du dépôt, à examiner.
-- Verdict attendu en production : IDENTIQUE, avec 3 lignes « plateforme ».
-- Code des fonctions comparé sans commentaires ni espaces (audit 00a §4.2).
-- ============================================================================
WITH depot(categorie, objet, valeur) AS (VALUES
  ('droits_colonnes', 'droits posés colonne par colonne', '0'),
  ('droits_donnees', 'avis_clics → service_role', 'rawd'),
  ('droits_donnees', 'avis_clics_id_seq → service_role', 'rU'),
  ('droits_donnees', 'clients → service_role', 'rawd'),
  ('droits_donnees', 'consentements → service_role', 'rawd'),
  ('droits_donnees', 'cron_passages → service_role', 'raw'),
  ('droits_donnees', 'cron_passages_id_seq → service_role', 'rU'),
  ('droits_donnees', 'device_tokens → service_role', 'rawd'),
  ('droits_donnees', 'diagnostics_camera → service_role', 'rad'),
  ('droits_donnees', 'marchands → service_role', 'rawd'),
  ('droits_donnees', 'notification_envois → service_role', 'rawd'),
  ('droits_donnees', 'notification_envois_id_seq → service_role', 'rU'),
  ('droits_donnees', 'notification_logs → authenticated', 'rawd'),
  ('droits_donnees', 'notification_logs → service_role', 'rawd'),
  ('droits_donnees', 'passes → service_role', 'rawd'),
  ('droits_donnees', 'points_de_vente → service_role', 'rawd'),
  ('droits_donnees', 'referral_credits → service_role', 'rawd'),
  ('droits_donnees', 'scans → service_role', 'rawd'),
  ('droits_donnees', 'workflow_executions → service_role', 'rawd'),
  ('droits_donnees', 'workflows → service_role', 'rawd'),
  ('evenement', 'ensure_rls', 'ddl_command_end | O | CREATE TABLE,CREATE TABLE AS,SELECT INTO | rls_auto_enable() | postgres'),
  ('fonction', 'admin_marchands_stats()', 'jsonb | sql | definer=false | s | - | code=ca8a05d052 | exec=111 | postgres'),
  ('fonction', 'annuler_scan(p_scan_id uuid, p_marchand_id uuid)', 'jsonb | plpgsql | definer=false | v | - | code=3b108bb459 | exec=111 | postgres'),
  ('fonction', 'credit_referral(p_parrain_client_id uuid, p_bonus_points integer)', 'TABLE(stored_value_avant integer, stored_value_apres integer) | plpgsql | definer=false | v | - | code=3a1baf914f | exec=111 | postgres'),
  ('fonction', 'crediter_scan(p_client_id uuid, p_marchand_id uuid, p_point_de_vente_id uuid, p_max_value integer, p_montant integer, p_type_programme text, p_cle uuid, p_msg_remise text, p_msg_recompense text, p_msg_progression text)', 'jsonb | plpgsql | definer=false | v | search_path=public | code=e6adbd0420 | exec=001 | postgres'),
  ('fonction', 'effacer_client(p_client_id uuid, p_marchand_id uuid)', 'void | plpgsql | definer=true | v | - | code=e0cc0950ba | exec=111 | postgres'),
  ('fonction', 'group_stats(p_marchand_id uuid)', 'jsonb | sql | definer=false | s | - | code=46c933a208 | exec=111 | postgres'),
  ('fonction', 'increment_stored_value(p_client_id uuid, p_max_value integer, p_amount integer, p_type_programme text)', 'TABLE(stored_value_avant integer, stored_value_apres integer, is_reset boolean) | plpgsql | definer=false | v | - | code=d4b664ce21 | exec=111 | postgres'),
  ('fonction', 'rls_auto_enable()', 'event_trigger | plpgsql | definer=true | v | search_path=pg_catalog | code=2965a64617 | exec=111 | postgres'),
  ('fonction', 'set_updated_at()', 'trigger | plpgsql | definer=false | v | - | code=d258fba5fe | exec=111 | postgres'),
  ('proprietaire', 'avis_clics', 'postgres'),
  ('proprietaire', 'avis_clics_id_seq', 'postgres'),
  ('proprietaire', 'clients', 'postgres'),
  ('proprietaire', 'consentements', 'postgres'),
  ('proprietaire', 'cron_passages', 'postgres'),
  ('proprietaire', 'cron_passages_id_seq', 'postgres'),
  ('proprietaire', 'device_tokens', 'postgres'),
  ('proprietaire', 'diagnostics_camera', 'postgres'),
  ('proprietaire', 'marchands', 'postgres'),
  ('proprietaire', 'notification_envois', 'postgres'),
  ('proprietaire', 'notification_envois_id_seq', 'postgres'),
  ('proprietaire', 'notification_logs', 'postgres'),
  ('proprietaire', 'passes', 'postgres'),
  ('proprietaire', 'points_de_vente', 'postgres'),
  ('proprietaire', 'referral_credits', 'postgres'),
  ('proprietaire', 'scans', 'postgres'),
  ('proprietaire', 'workflow_executions', 'postgres'),
  ('proprietaire', 'workflows', 'postgres'),
  ('rls', 'avis_clics', 'true/false'),
  ('rls', 'clients', 'true/false'),
  ('rls', 'consentements', 'true/false'),
  ('rls', 'cron_passages', 'true/false'),
  ('rls', 'device_tokens', 'true/false'),
  ('rls', 'diagnostics_camera', 'true/false'),
  ('rls', 'marchands', 'true/false'),
  ('rls', 'notification_envois', 'true/false'),
  ('rls', 'notification_logs', 'true/false'),
  ('rls', 'passes', 'true/false'),
  ('rls', 'points_de_vente', 'true/false'),
  ('rls', 'referral_credits', 'true/false'),
  ('rls', 'scans', 'true/false'),
  ('rls', 'workflow_executions', 'true/false'),
  ('rls', 'workflows', 'true/false'),
  ('structure', 'avis_clics', 'r 15e41f26a9 fa2939e75d afba50eedb d41d8cd98f d41d8cd98f'),
  ('structure', 'avis_clics_id_seq', 'S'),
  ('structure', 'clients', 'r 3a7d704fac 8d1263d6ed 718580fca1 cd81ee2ec6 92c8f318d5'),
  ('structure', 'consentements', 'r 6522d2d2b5 47372e7a27 2c19580a47 d41d8cd98f d41d8cd98f'),
  ('structure', 'cron_passages', 'r 153b7679bb 3e4c5482d2 4c493ae770 d41d8cd98f d41d8cd98f'),
  ('structure', 'cron_passages_id_seq', 'S'),
  ('structure', 'device_tokens', 'r e30b39da5b cfe0042077 562cf11d3a d41d8cd98f ef98a53312'),
  ('structure', 'diagnostics_camera', 'r 81c6e53263 ca71463871 495fdbec43 d41d8cd98f d41d8cd98f'),
  ('structure', 'marchands', 'r ec310c2d79 a989e54260 b96831cf15 d8c0ed18e6 ba2c64374a'),
  ('structure', 'notification_envois', 'r 6172a47dca e2628ff5df eca7c370e4 d41d8cd98f d41d8cd98f'),
  ('structure', 'notification_envois_id_seq', 'S'),
  ('structure', 'notification_logs', 'r ac25dbfa84 407348e994 fd86b47603 d41d8cd98f d41d8cd98f'),
  ('structure', 'passes', 'r 2fa65e1dc6 0dde65652c fe86087221 7ccca379fe f5ac52b87d'),
  ('structure', 'points_de_vente', 'r cd0720260d 7c093a7de5 7d4735111c d41d8cd98f d41d8cd98f'),
  ('structure', 'referral_credits', 'r 9d35856bf2 8b229706ca 1c32aca53e d41d8cd98f d41d8cd98f'),
  ('structure', 'scans', 'r 5cbc9144a1 eae213ba36 2394842826 d41d8cd98f 78bfcdeee5'),
  ('structure', 'workflow_executions', 'r 593dc5810c 78fff07096 aaacb2ced5 d41d8cd98f d41d8cd98f'),
  ('structure', 'workflows', 'r 51f418dd71 89d292be10 26b595d7e8 d41d8cd98f d41d8cd98f'),
  ('types', 'types personnalisés', '(aucun)')
),
vivant AS (
  -- ============================================================================
  -- État d'une base, une ligne par objet : (categorie, objet, valeur).
  -- Inclus tel quel par generer.sh dans ecarts_prod_depot.sql (ne pas lancer seul).
  -- Formules de l'audit 00a (P2, P3, P4, P8) : colonnes triées par nom, préfixes
  -- « public. » et « extensions. » retirés, code des fonctions comparé sans
  -- commentaires ni espaces (00a §4.2). Compatible PostgreSQL 16 et 17.
  -- ============================================================================
  SELECT 'structure'::text AS categorie, c.relname::text AS objet,
         c.relkind::text || CASE WHEN c.relkind = 'S' THEN '' ELSE ' '
         || left(md5((SELECT string_agg(a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull || '|'
                   || coalesce(regexp_replace(pg_get_expr(ad.adbin, ad.adrelid), '\m(public|extensions)\.', '', 'g'), '')
                   || '|' || a.attidentity::text || '|' || a.attgenerated::text, ';' ORDER BY a.attname)
                   FROM pg_attribute a LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
                  WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)), 10) || ' '
         || left(md5(coalesce((SELECT string_agg(k.conname || '|' || regexp_replace(pg_get_constraintdef(k.oid), '\m(public|extensions)\.', '', 'g'), ';' ORDER BY k.conname)
                   FROM pg_constraint k WHERE k.conrelid = c.oid), '')), 10) || ' '
         || left(md5(coalesce((SELECT string_agg(regexp_replace(pg_get_indexdef(i.indexrelid), '\m(public|extensions)\.', '', 'g'), ';' ORDER BY 1)
                   FROM pg_index i WHERE i.indrelid = c.oid), '')), 10) || ' '
         || left(md5(coalesce((SELECT string_agg(regexp_replace(pg_get_triggerdef(g.oid), '\m(public|extensions)\.', '', 'g'), ';' ORDER BY g.tgname)
                   FROM pg_trigger g WHERE g.tgrelid = c.oid AND NOT g.tgisinternal), '')), 10) || ' '
         || left(md5(coalesce((SELECT string_agg(p.policyname || '|' || p.cmd || '|' || p.permissive || '|' || array_to_string(p.roles, ',')
                   || '|' || coalesce(p.qual, '') || '|' || coalesce(p.with_check, ''), ';' ORDER BY p.policyname)
                   FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname), '')), 10) END AS valeur
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','S')
  UNION ALL
  SELECT 'rls', c.relname, c.relrowsecurity::text || '/' || c.relforcerowsecurity::text
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
  UNION ALL
  SELECT 'proprietaire', c.relname, pg_get_userbyid(c.relowner)
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','S')
  UNION ALL
  -- Droits « données » (lire, créer, modifier, supprimer ; séquences : lire, avancer, utiliser)
  -- et droits « structure » (vider, référencer, déclencher). Seuls les droits non vides.
  SELECT CASE WHEN pv.genre = 'd' THEN 'droits_donnees' ELSE 'droits_structure' END,
         c.relname || ' → ' || r.rolname,
         string_agg(pv.lettre, '' ORDER BY pv.ordre)
    FROM pg_class c
   CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
   CROSS JOIN (VALUES (1,'SELECT','r','d','T'), (2,'INSERT','a','d','T'), (3,'UPDATE','w','d','T'), (4,'DELETE','d','d','T'),
                      (5,'TRUNCATE','D','s','T'), (6,'REFERENCES','x','s','T'), (7,'TRIGGER','t','s','T'),
                      (1,'SELECT','r','d','S'), (3,'UPDATE','w','d','S'), (8,'USAGE','U','d','S')) AS pv(ordre, priv, lettre, genre, cible)
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','S')
     AND pv.cible = CASE WHEN c.relkind = 'S' THEN 'S' ELSE 'T' END
     AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege(r.rolname, c.oid, pv.priv)
              ELSE has_table_privilege(r.rolname, c.oid, pv.priv) END
   GROUP BY 1, 2
  UNION ALL
  SELECT 'droits_colonnes', 'droits posés colonne par colonne', count(*)::text
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
   WHERE c.relnamespace = 'public'::regnamespace AND a.attacl IS NOT NULL
  UNION ALL
  SELECT 'fonction', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         pg_get_function_result(p.oid) || ' | ' || l.lanname || ' | definer=' || p.prosecdef || ' | ' || p.provolatile::text
         || ' | ' || coalesce(array_to_string(p.proconfig, ','), '-')
         || ' | code=' || left(md5(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', '', 'g')), 10)
         || ' | exec=' || has_function_privilege('anon', p.oid, 'EXECUTE')::int || has_function_privilege('authenticated', p.oid, 'EXECUTE')::int
                       || has_function_privilege('service_role', p.oid, 'EXECUTE')::int
         || ' | ' || pg_get_userbyid(p.proowner)
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.pronamespace = 'public'::regnamespace
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  UNION ALL
  -- Déclencheurs d'événements créés par le projet (ceux de la plateforme appartiennent à supabase_admin).
  SELECT 'evenement', e.evtname,
         e.evtevent || ' | ' || e.evtenabled::text || ' | ' || coalesce(array_to_string(e.evttags, ','), '*')
         || ' | ' || e.evtfoid::regprocedure::text || ' | ' || pg_get_userbyid(e.evtowner)
    FROM pg_event_trigger e WHERE pg_get_userbyid(e.evtowner) <> 'supabase_admin'
  UNION ALL
  SELECT 'types', 'types personnalisés', coalesce(string_agg(t.typname || ':' || t.typtype::text, ',' ORDER BY t.typname), '(aucun)')
    FROM pg_type t
   WHERE t.typnamespace = 'public'::regnamespace AND t.typtype IN ('e','d','c')
     AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid AND c.relkind <> 'c')
),
ecarts AS (
  SELECT coalesce(v.categorie, d.categorie) AS categorie,
         coalesce(v.objet, d.objet)         AS objet,
         coalesce(v.valeur, CASE WHEN coalesce(v.categorie, d.categorie) LIKE 'droits%' THEN '(aucun droit)' ELSE '(absent)' END) AS production,
         coalesce(d.valeur, CASE WHEN coalesce(v.categorie, d.categorie) LIKE 'droits%' THEN '(aucun droit)' ELSE '(absent)' END) AS depot
    FROM vivant v
    FULL JOIN depot d ON d.categorie = v.categorie AND d.objet = v.objet
   WHERE v.valeur IS DISTINCT FROM d.valeur
),
classes AS (
  SELECT e.*,
         CASE WHEN e.categorie = 'droits_structure' AND e.depot = '(aucun droit)' AND e.production ~ '^D?x?t?$'
              THEN 'plateforme' ELSE 'ECART' END AS classe
    FROM ecarts e
),
compares AS (
  SELECT categorie, count(*) AS n FROM (SELECT categorie, objet FROM vivant UNION SELECT categorie, objet FROM depot) u GROUP BY 1
)
SELECT 0 AS ordre, 'VERDICT' AS categorie,
       CASE WHEN (SELECT count(*) FROM classes WHERE classe = 'ECART') = 0
            THEN 'IDENTIQUE au dépôt (hors plateforme)' ELSE 'ÉCART — à examiner' END AS objet,
       (SELECT count(*) FROM classes WHERE classe = 'ECART') || ' écart(s) · '
       || (SELECT count(*) FROM classes WHERE classe = 'plateforme') || ' plateforme' AS production,
       'dépôt jusqu''à migration_051_credit_incassable.sql' AS depot, NULL AS lecture
UNION ALL
SELECT 1, c.categorie, c.n || ' objets comparés',
       coalesce((SELECT count(*) FROM classes k WHERE k.categorie = c.categorie), 0) || ' écart(s)', NULL, NULL
  FROM compares c
UNION ALL
SELECT 2, categorie, objet, production, depot, 'la base diffère du dépôt → à examiner'
  FROM classes WHERE classe = 'ECART'
UNION ALL
SELECT 3, 'droits_structure', split_part(objet, ' → ', 2) || ' : ' || string_agg(DISTINCT production, ',') || ' sur '
       || count(*) || ' objets', 'hérité', '(aucun droit)',
       'privilèges par défaut Supabase → non consigné (décision du 2026-09-29)'
  FROM classes WHERE classe = 'plateforme' GROUP BY split_part(objet, ' → ', 2)
ORDER BY 1, 2, 3;
