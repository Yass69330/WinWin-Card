-- ============================================================
-- Migration 003 — Valeur d'affichage indépendante sur le pass
-- ============================================================
-- display_max_value : dénominateur affiché sur le pass (ex : X/10).
--   Nullable — si NULL, on utilise max_value comme fallback.
--   max_value reste le seuil de reset/récompense.
-- ============================================================

alter table marchands
  add column if not exists display_max_value integer;

comment on column marchands.display_max_value is
  'Dénominateur affiché sur le pass (ex : "7/10"). NULL = utilise max_value. max_value reste le seuil de reset.';
