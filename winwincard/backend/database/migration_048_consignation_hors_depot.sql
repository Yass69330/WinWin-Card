-- Migration 048 : consigner ce qui vivait en production hors du dépôt (étape 9)
--
-- POURQUOI. Rejoué tel quel (schema.sql + 002→047), le dépôt donnait une base où
-- le serveur ne pouvait lire AUCUNE des 7 tables centrales : « permission denied »
-- pour service_role sur marchands, clients, passes, scans, device_tokens,
-- consentements et workflows (constaté sur PostgreSQL 16 le 2026-09-29). La
-- production a ces droits, posés hors de tout fichier, d'origine inconnue (audit
-- 00a §5.1). Une restauration après perte du projet, la base jetable du filet de
-- tests ou un second projet Supabase rejoués depuis le dépôt ne fonctionnaient pas.
--
-- CE QUE LA PRODUCTION AVAIT ET LE DÉPÔT NON. Liste prouvée par la requête
-- d'écarts lancée en production le 2026-09-29 : 13 écarts, tous déjà
-- photographiés le 26/09, aucun imprévu.
--   1) SELECT, INSERT, UPDATE, DELETE de service_role sur les 7 tables (même
--      forme que 028 et 030). `workflows` est une table morte (00b) : ses droits
--      sont consignés quand même, la suppression relève du nettoyage ;
--   2) RLS active sur diagnostics_camera, points_de_vente, referral_credits et
--      workflow_executions ;
--   3) fonction public.rls_auto_enable() et déclencheur d'événement ensure_rls :
--      toute table créée dans public reçoit la RLS d'office (00a §6.1). Texte
--      relevé en production (00a annexe A, P8) ; son empreinte de code est celle
--      de la production (2965a64617), au moins d'espaces près.
--
-- EN PRODUCTION, CETTE MIGRATION NE FAIT RIEN. Chaque bloc ne s'exécute que si
-- l'élément MANQUE. Quand tout existe déjà : aucun GRANT, aucun ALTER, aucun
-- CREATE — donc aucun verrou, aucune écriture au catalogue, aucun rechargement du
-- cache de l'API. Sur une base neuve, elle pose tout. Rejouable.
--
-- DÉLIBÉRÉMENT NON CONSIGNÉ (décisions de pilotage du 2026-09-29) :
--   - TRUNCATE, REFERENCES, TRIGGER de anon, authenticated et service_role sur
--     les 14 tables : hérités des privilèges par défaut de Supabase, inutiles au
--     serveur. Les écrire ici graverait une exposition que l'étape 7
--     (verrouillage) veut réduire ;
--   - le texte de 4 fonctions, qui ne diffère que par des commentaires (00a §4) :
--     le code est identique, la requête d'écarts le vérifie.
--
-- HYPOTHÈSES — ce qui ferait casser cette migration.
--   - CREATE EVENT TRIGGER exige un superutilisateur. Sur Supabase, le rôle
--     postgres le peut (le déclencheur de production lui appartient). Sur un
--     projet NEUF, ce n'est pas vérifié avant l'environnement de test (étape 15).
--     S'il le refusait, la transaction entière serait annulée : rien de posé.
--   - Toute table créée APRÈS cette migration reçoit la RLS d'office, comme en
--     production. Le serveur n'en est pas gêné (service_role ignore la RLS), mais
--     il lui faut toujours son GRANT explicite (leçon de 028 et 030).
--
-- CONTRÔLE. database/requetes/ecarts_prod_depot/ : la requête d'écarts, régénérée
-- depuis le dépôt (048 comprise), doit rendre en production 0 écart hors des
-- 3 lignes « plateforme ».
--
-- Vérifiée avant exécution sur PostgreSQL 16 : chaîne complète rejouée sans
-- échec ; second passage sans effet ; passage sur une copie simulée de la
-- production (validée par la requête du 29/09) sans aucune écriture au
-- catalogue ; 14 tables sur 14 accessibles au serveur ; RLS posée d'office sur
-- une table créée après coup.

BEGIN;
SET lock_timeout = '3s';

-- 1) Droits du serveur sur les 7 tables centrales.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['marchands','clients','passes','scans',
                           'device_tokens','consentements','workflows'] LOOP
    IF NOT (has_table_privilege('service_role', format('public.%I', t), 'SELECT')
        AND has_table_privilege('service_role', format('public.%I', t), 'INSERT')
        AND has_table_privilege('service_role', format('public.%I', t), 'UPDATE')
        AND has_table_privilege('service_role', format('public.%I', t), 'DELETE')) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
      RAISE NOTICE '048 : droits de service_role posés sur %', t;
    END IF;
  END LOOP;
END $$;

-- 2) RLS sur les 4 tables où la production l'a active.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['diagnostics_camera','points_de_vente',
                           'referral_credits','workflow_executions'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = format('public.%I', t)::regclass) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      RAISE NOTICE '048 : RLS activée sur %', t;
    END IF;
  END LOOP;
END $$;

-- 3) RLS d'office sur toute nouvelle table de public : fonction + déclencheur.
--    Un échec d'activation est seulement journalisé : il ne fait jamais échouer
--    la création de la table (comportement de production).
DO $bloc$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NULL THEN
    EXECUTE $ddl$
CREATE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
$ddl$;
    RAISE NOTICE '048 : fonction rls_auto_enable() créée';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ensure_rls') THEN
    EXECUTE $ddl$
CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable()
$ddl$;
    RAISE NOTICE '048 : déclencheur d''événement ensure_rls créé';
  END IF;
END $bloc$;

COMMIT;

-- ── VÉRIFICATION (à coller juste après) ──────────────────────────────────
-- Les quatre colonnes doivent valoir true.
--
-- SELECT
--   (SELECT bool_and(has_table_privilege('service_role', 'public.' || t, 'SELECT')
--                AND has_table_privilege('service_role', 'public.' || t, 'INSERT')
--                AND has_table_privilege('service_role', 'public.' || t, 'UPDATE')
--                AND has_table_privilege('service_role', 'public.' || t, 'DELETE'))
--      FROM unnest(ARRAY['marchands','clients','passes','scans',
--                        'device_tokens','consentements','workflows']) t)  AS droits_7_tables_ok,
--   (SELECT bool_and(relrowsecurity) FROM pg_class
--     WHERE oid IN ('public.diagnostics_camera'::regclass, 'public.points_de_vente'::regclass,
--                   'public.referral_credits'::regclass, 'public.workflow_executions'::regclass)) AS rls_4_tables_ok,
--   to_regprocedure('public.rls_auto_enable()') IS NOT NULL               AS fonction_ok,
--   EXISTS (SELECT 1 FROM pg_event_trigger
--            WHERE evtname = 'ensure_rls' AND evtenabled = 'O')             AS declencheur_ok;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- AUCUN EN PRODUCTION : la migration n'y change rien. Ne JAMAIS y révoquer ces
-- droits : sans eux, le serveur ne lit plus marchands et toute la plateforme
-- tombe. Sur une base rejouée (test), le retour arrière est de la supprimer.
