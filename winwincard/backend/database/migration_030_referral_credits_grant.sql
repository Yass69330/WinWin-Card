-- Migration 030 : GRANT service_role sur referral_credits (crédit parrainage)
--
-- Même bug que migration_028 (workflow_executions) : referral_credits, créée
-- en migration_014, n'a jamais reçu de GRANT DML pour service_role. Le backend
-- (clé service_role via PostgREST) ne peut donc pas écrire le « ticket » de
-- parrainage → l'insert échoue (permission denied) → creditReferrerIfApplicable
-- lève, l'erreur est loggée (scan.js), mais LE PARRAIN N'EST JAMAIS CRÉDITÉ.
-- Explique aussi pourquoi referral_credits était vide depuis toujours.
--
-- Fix : accorder la DML à service_role. Le code (scan.js + RPC credit_referral
-- + index unique referral_credits_filleul_unique de migration_024) est déjà
-- correct : dès le grant posé, le ticket s'insère, le parrain est crédité et la
-- dédup « un crédit par filleul à vie » fonctionne. Aucun code à toucher.
--
-- À exécuter dans Supabase. Rejouable sans risque.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.referral_credits TO service_role;
