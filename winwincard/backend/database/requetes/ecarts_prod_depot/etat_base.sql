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
