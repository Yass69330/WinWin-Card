-- Icône Apple Wallet notification (29×29 px @1x, 87×87 px @3x recommandé)
-- Optionnel : si vide, fallback sur logo_url
alter table marchands add column if not exists icon_url text;
