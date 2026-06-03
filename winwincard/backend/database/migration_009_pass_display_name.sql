-- Nom court affiché dans logoText sur Apple Wallet (max ~20 chars recommandé).
-- Optionnel : si vide, fallback sur nom complet.
alter table marchands add column if not exists pass_display_name text;
