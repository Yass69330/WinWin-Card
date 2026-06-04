-- migration_013 : simplifie la config landing Pro+ en un seul toggle
-- Remplace les 3 colonnes landing_show_* par landing_premium (tout ou rien)

ALTER TABLE marchands
  DROP COLUMN IF EXISTS landing_show_email,
  DROP COLUMN IF EXISTS landing_show_phone,
  DROP COLUMN IF EXISTS landing_show_birthday,
  ADD COLUMN IF NOT EXISTS landing_premium boolean NOT NULL DEFAULT false;
