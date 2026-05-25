-- ============================================================
-- Migration 002 — Colonnes images spécifiques Google Wallet
-- ============================================================
-- google_logo_url  : logo carré 660×660 px affiché en cercle dans Google Wallet
--                   Fallback : logo_url (Apple/général)
-- google_hero_url  : image bas de carte 1032×336 px (~3:1)
--                   Fallback : image_strip_url (Apple/général)
-- ============================================================

alter table marchands
  add column if not exists google_logo_url text,
  add column if not exists google_hero_url text;

comment on column marchands.google_logo_url is
  'Logo carré 660×660 px pour Google Wallet (affiché en cercle). Fallback : logo_url.';

comment on column marchands.google_hero_url is
  'Image hero 1032×336 px pour Google Wallet (bas de carte). Fallback : image_strip_url.';
