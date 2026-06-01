create table if not exists notification_logs (
  id             uuid primary key default uuid_generate_v4(),
  marchand_id    uuid not null references marchands(id) on delete cascade,
  message        text not null,
  envoyes_apple  int  not null default 0,
  envoyes_google int  not null default 0,
  total_apple    int  not null default 0,
  total_google   int  not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists idx_notif_logs_marchand on notification_logs(marchand_id, created_at desc);

-- RLS requis : sans ça PostgREST refuse l'accès même avec service_role.
-- service_role bypasse automatiquement toutes les policies RLS.
alter table notification_logs enable row level security;
