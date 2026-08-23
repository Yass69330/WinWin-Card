-- Migration 027 : workflow anniversaire (birthday)
--
-- Deux colonnes sur marchands, miroir exact de workflow_inactive_* :
--   • workflow_birthday_enabled : active l'envoi automatique du message
--     d'anniversaire (le jour J, une fois par an). Réservé Pro+ AVEC landing
--     premium (seule surface où le client saisit sa date de naissance).
--   • workflow_birthday_message : message personnalisé optionnel
--     ({prenom}/{nom}). Vide → message standard bilingue (i18n 'birthday').
--
-- ⚠️ DÉJÀ EXÉCUTÉE EN PROD par le fondateur avant l'écriture du code. Ce fichier
-- existe pour la RÉPRODUCTIBILITÉ du schéma (règle §3.7 : le repo doit dire la
-- vérité — cf. incident item [3] de l'audit #3). IF NOT EXISTS → rejouable sans
-- effet sur une base où les colonnes existent déjà.
--
-- Le workflow n'écrit JAMAIS sur stored_value (simple message via notifyClient)
-- et ne consomme aucun quota (aucune écriture dans notification_logs). Aucune
-- nouvelle colonne sur clients ni workflow_executions : la dédup « une fois par
-- an » se fait par requête (executed_at >= 1er janvier UTC), workflow_type='birthday'.

ALTER TABLE marchands
  ADD COLUMN IF NOT EXISTS workflow_birthday_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS workflow_birthday_message text;
