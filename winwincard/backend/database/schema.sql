-- ============================================================
-- WinWin Card — Schéma Supabase V1
-- ============================================================
-- Extensions
-- ============================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- MARCHANDS
-- ============================================================

create table marchands (
  id                uuid primary key default uuid_generate_v4(),
  nom               text not null,
  slug              text not null unique,
  logo_url          text,
  couleur_fond      text not null default '#ffffff',
  couleur_texte     text not null default '#000000',
  couleur_label     text not null default '#888888',
  image_strip_url   text,
  images_tiers      jsonb,
  -- [{"min": 0, "max": 4, "url": "..."}, {"min": 5, "max": 9, "url": "..."}]
  texte_landing     text,
  max_value         integer not null default 10,
  forfait           text not null default 'pro' check (forfait in ('basic', 'pro', 'pro_plus')),
  actif             boolean not null default true,
  email_contact     text,
  password_hash     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_marchands_slug on marchands (slug);

-- ============================================================
-- CLIENTS
-- ============================================================

create table clients (
  id                  uuid primary key default uuid_generate_v4(),
  marchand_id         uuid not null references marchands (id) on delete cascade,
  prenom              text not null,
  -- colonnes Pro+ présentes en base, vides en V1
  email               text,
  telephone           text,
  date_anniversaire   date,
  pass_serial_number  text unique not null default uuid_generate_v4()::text,
  stored_value        integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  -- soft delete RGPD : on garde la ligne pour intégrité référentielle
  -- mais on efface les données personnelles
  unique (marchand_id, pass_serial_number)
);

create index idx_clients_marchand on clients (marchand_id);
create index idx_clients_serial   on clients (pass_serial_number);

-- ============================================================
-- PASSES
-- ============================================================

create table passes (
  id                uuid primary key default uuid_generate_v4(),
  client_id         uuid not null references clients (id) on delete cascade,
  marchand_id       uuid not null references marchands (id) on delete cascade,
  serial_number     text not null unique,
  apple_pass_url    text,
  google_pass_url   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_passes_client     on passes (client_id);
create index idx_passes_serial     on passes (serial_number);
create index idx_passes_marchand   on passes (marchand_id);

-- ============================================================
-- DEVICE TOKENS APNs (registration Apple Wallet)
-- ============================================================
-- Apple envoie un device push token quand le client installe son pass.
-- Un client peut avoir plusieurs appareils.

create table device_tokens (
  id              uuid primary key default uuid_generate_v4(),
  pass_id         uuid not null references passes (id) on delete cascade,
  client_id       uuid not null references clients (id) on delete cascade,
  marchand_id     uuid not null references marchands (id) on delete cascade,
  serial_number   text not null,
  device_id       text not null,
  push_token      text not null,
  created_at      timestamptz not null default now(),
  unique (device_id, serial_number)
);

create index idx_device_tokens_marchand on device_tokens (marchand_id);
create index idx_device_tokens_serial   on device_tokens (serial_number);
create index idx_device_tokens_client   on device_tokens (client_id);

-- ============================================================
-- SCANS
-- ============================================================

create table scans (
  id                    uuid primary key default uuid_generate_v4(),
  client_id             uuid not null references clients (id) on delete cascade,
  marchand_id           uuid not null references marchands (id) on delete cascade,
  stored_value_avant    integer not null,
  stored_value_apres    integer not null,
  date_scan             timestamptz not null default now()
);

create index idx_scans_client   on scans (client_id);
create index idx_scans_marchand on scans (marchand_id);
create index idx_scans_date     on scans (date_scan desc);

-- ============================================================
-- WORKFLOWS (structure vide — V2)
-- ============================================================

create table workflows (
  id            uuid primary key default uuid_generate_v4(),
  marchand_id   uuid not null references marchands (id) on delete cascade,
  nom           text,
  config        jsonb,
  actif         boolean not null default false,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- CONSENTEMENTS RGPD (structure prête — V2)
-- ============================================================

create table consentements (
  id            uuid primary key default uuid_generate_v4(),
  client_id     uuid not null references clients (id) on delete cascade,
  marchand_id   uuid not null references marchands (id) on delete cascade,
  type          text not null,
  valeur        boolean not null default false,
  horodatage    timestamptz not null default now()
);

-- ============================================================
-- TRIGGER updated_at automatique
-- ============================================================

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_marchands_updated_at
  before update on marchands
  for each row execute function set_updated_at();

create trigger trg_clients_updated_at
  before update on clients
  for each row execute function set_updated_at();

create trigger trg_passes_updated_at
  before update on passes
  for each row execute function set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY (RLS) — multi-tenant isolation
-- ============================================================

alter table marchands      enable row level security;
alter table clients        enable row level security;
alter table passes         enable row level security;
alter table device_tokens  enable row level security;
alter table scans          enable row level security;
alter table workflows      enable row level security;
alter table consentements  enable row level security;

-- Rôles applicatifs :
--   anon         → aucun accès direct
--   service_role → bypass RLS (backend Node.js utilise ce rôle via SUPABASE_SERVICE_KEY)
--   authenticated → dashboard marchand via JWT

-- Les policies ci-dessous sécurisent l'accès via le client public Supabase.
-- Le backend Node.js utilise la service_role key et bypasse le RLS —
-- l'isolation multi-tenant est alors enforced au niveau applicatif.

-- Marchands : un marchand ne voit que son propre enregistrement
create policy "marchand_select_own"
  on marchands for select
  using (id = (current_setting('app.marchand_id', true))::uuid);

-- Clients : un marchand ne voit que ses clients
create policy "clients_select_own_marchand"
  on clients for select
  using (
    marchand_id = (current_setting('app.marchand_id', true))::uuid
    and deleted_at is null
  );

create policy "clients_insert_own_marchand"
  on clients for insert
  with check (marchand_id = (current_setting('app.marchand_id', true))::uuid);

create policy "clients_update_own_marchand"
  on clients for update
  using (marchand_id = (current_setting('app.marchand_id', true))::uuid);

-- Passes
create policy "passes_select_own_marchand"
  on passes for select
  using (marchand_id = (current_setting('app.marchand_id', true))::uuid);

create policy "passes_insert_own_marchand"
  on passes for insert
  with check (marchand_id = (current_setting('app.marchand_id', true))::uuid);

-- Device tokens
create policy "device_tokens_select_own_marchand"
  on device_tokens for select
  using (marchand_id = (current_setting('app.marchand_id', true))::uuid);

-- Scans
create policy "scans_select_own_marchand"
  on scans for select
  using (marchand_id = (current_setting('app.marchand_id', true))::uuid);
