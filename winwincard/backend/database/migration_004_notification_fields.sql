-- Migration 004 — Champs notification marketing Apple Wallet
-- À exécuter dans Supabase SQL Editor
-- Ces champs stockent la dernière notification broadcast d'un marchand.
-- Quand le pass est re-téléchargé via push silencieux, iOS détecte le
-- changement de champ et génère automatiquement une notification visible.

alter table marchands
  add column if not exists notification_titre   text,
  add column if not exists notification_message text;

comment on column marchands.notification_titre   is 'Titre de la dernière notification marketing envoyée (affiché dans le pass + notification iOS)';
comment on column marchands.notification_message is 'Corps de la dernière notification marketing envoyée';
