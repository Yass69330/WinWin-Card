-- Migration 011 : toggles champs landing page par marchand (Pro+)
-- Défaut true = rétrocompatibilité (marchands Pro+ existants conservent tous les champs)

ALTER TABLE marchands
  ADD COLUMN IF NOT EXISTS landing_show_email    boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS landing_show_phone    boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS landing_show_birthday boolean DEFAULT true;
