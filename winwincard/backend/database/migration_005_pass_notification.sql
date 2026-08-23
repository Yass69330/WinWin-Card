-- migration_005 : notification par pass (scan → push visible iOS)
-- Chaque scan stocke son message dans passes.notification_message
-- au lieu du message global marchands.notification_message.
-- Le pass génère notification_txt à partir de cette colonne (fallback : marchand).

alter table passes
  add column if not exists notification_message text;
