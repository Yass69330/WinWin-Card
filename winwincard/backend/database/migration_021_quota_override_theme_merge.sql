-- Migration 021
-- 1. Override quota notifications mensuel par marchand (admin uniquement).
--    Si NULL → fallback sur le défaut du forfait (aucune régression).
ALTER TABLE marchands
  ADD COLUMN IF NOT EXISTS notification_quota_override integer;

-- 2. Fusion thèmes strip : 'premium' → 'icon_metier'.
--    Le cadeau sur le dernier tampon devient comportement par défaut (plus une option séparée).
UPDATE marchands
   SET strip_theme = 'icon_metier'
 WHERE strip_theme = 'premium';

-- Mise à jour de la contrainte CHECK pour retirer 'premium'.
-- (nom auto-généré par Postgres pour la contrainte inline de migration_018)
ALTER TABLE marchands
  DROP CONSTRAINT IF EXISTS marchands_strip_theme_check;

ALTER TABLE marchands
  ADD CONSTRAINT marchands_strip_theme_check
    CHECK (strip_theme IN ('logo_stamp', 'icon_metier'));

-- 3. Invalidation du cache strips (cercles vides sans icône + nouvelles tailles label/tampons).
UPDATE marchands
   SET strip_config_version = COALESCE(strip_config_version, 1) + 1
 WHERE strip_mode IS NOT NULL;
