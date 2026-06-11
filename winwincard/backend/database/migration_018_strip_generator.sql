-- Migration 018 — Génération programmatique des images de strip / hero
-- strip_mode NULL = comportement actuel préservé (zéro régression pour les marchands existants)
-- strip_mode 'static' = strip généré sans tampons (Basic+)
-- strip_mode 'stamps' = strip généré avec rangée de tampons (Pro+)
ALTER TABLE marchands
  ADD COLUMN IF NOT EXISTS strip_mode text
    CHECK (strip_mode IN ('static', 'stamps')),
  ADD COLUMN IF NOT EXISTS strip_theme text DEFAULT 'icon_metier'
    CHECK (strip_theme IN ('logo_stamp', 'icon_metier', 'premium')),
  ADD COLUMN IF NOT EXISTS stamp_icon text DEFAULT 'coffee',
  ADD COLUMN IF NOT EXISTS strip_custom_background_url text,
  ADD COLUMN IF NOT EXISTS strip_config_version int DEFAULT 1 NOT NULL;
