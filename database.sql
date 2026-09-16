-- ============================================
-- SCATTER CLAIM SYSTEM - SUPABASE SCHEMA
-- Execute this in Supabase SQL Editor
-- ============================================

-- SITES
create table if not exists public.sites (
  id bigserial primary key,
  site_id text unique not null,
  label text not null,
  active boolean default true,
  created_at timestamptz default now()
);

insert into public.sites (site_id, label) values ('bandar80', 'BANDAR80')
on conflict (site_id) do nothing;

-- CLAIMS
create table if not exists public.claims (
  id bigserial primary key,
  site text not null,
  user_id text not null,
  kode_tiket text not null,
  betting bigint default 0,
  scatter int default 3,
  status text default 'PENDING',
  detail text default '',
  -- Hasil verifikasi pipeline (diisi process/auto):
  betting_actual bigint default null,
  scatter_actual int default null,
  hadiah_expected bigint default null,
  hadiah_actual bigint default null,
  payout text default '',
  reject_reason text default '',
  check_attempts int default 0,
  checked_at timestamptz default null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_claims_user on public.claims (user_id);
create index if not exists idx_claims_status on public.claims (status);

-- Kode tiket UNIQUE: sekali diklaim, tidak bisa dipakai lagi (anti double-claim / race condition)
create unique index if not exists idx_claims_tiket_unique on public.claims (kode_tiket);

-- SETTINGS (token history API, status auto-mode, konfigurasi)
create table if not exists public.settings (
  key text primary key,
  value jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- LOGS
create table if not exists public.logs (
  id bigserial primary key,
  action text not null,
  detail text default '',
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_logs_created on public.logs (created_at desc);

-- ============================================
-- RLS: public read/write for anon (simple setup)
-- Idempotent: aman dijalankan berkali-kali
-- ============================================
alter table public.sites enable row level security;
alter table public.claims enable row level security;
alter table public.settings enable row level security;
alter table public.logs enable row level security;

drop policy if exists "sites public read" on public.sites;
drop policy if exists "claims public all" on public.claims;
drop policy if exists "settings public all" on public.settings;
drop policy if exists "logs public readonly" on public.logs;

create policy "sites public read" on public.sites for select using (true);
create policy "claims public all" on public.claims for all using (true) with check (true);
create policy "settings public all" on public.settings for all using (true) with check (true);
create policy "logs public readonly" on public.logs for select using (true);

-- ============================================
-- AUTO RELAX WEB - ROWS & LOGS
-- Mirip chrome.storage ekstensi, kini di Supabase
-- ============================================
create table if not exists public.relax_rows (
  id bigserial primary key,
  "user" text default '',
  has_ts boolean default false,
  kode_tiket text not null,
  kode2 text default '',
  auto_status text default '',
  auto_col9 text default '',
  auto_col10 text default '',
  manual_status text default '',
  betting text default '',
  payout text default '',
  total_free_spin text default '',
  transaction_id text default '',
  profit text default '',
  balance text default '',
  spin_type text default '',
  symbols jsonb default '[]'::jsonb,
  payout_detail jsonb default '[]'::jsonb,
  free_spin_detail jsonb default '[]'::jsonb,
  secure_status text default '',
  keterangan text default '',
  auto_retry_check int default 0,
  source text default 'web',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_relax_rows_user on public.relax_rows (lower("user"));
create index if not exists idx_relax_rows_created on public.relax_rows (created_at desc);

create table if not exists public.relax_logs (
  id bigserial primary key,
  level text default 'info',
  message text default '',
  created_at timestamptz default now()
);

create index if not exists idx_relax_logs_created on public.relax_logs (created_at desc);

alter table public.relax_rows enable row level security;
alter table public.relax_logs enable row level security;

drop policy if exists "relax_rows public all" on public.relax_rows;
drop policy if exists "relax_logs public all" on public.relax_logs;

create policy "relax_rows public all" on public.relax_rows for all using (true) with check (true);
create policy "relax_logs public all" on public.relax_logs for all using (true) with check (true);

-- ============================================
-- AUTO RELAX WEB - MEMO + TYPING RANKINGS
-- ============================================
create table if not exists public.memos (
  id bigserial primary key,
  author_email text default '',
  author_name text default '',
  message text default '',
  created_at timestamptz default now()
);

create index if not exists idx_memos_created on public.memos (created_at desc);
create index if not exists idx_memos_author on public.memos (author_email);

create table if not exists public.typing_rankings (
  id bigserial primary key,
  email text default '',
  name text default '',
  wpm numeric default 0,
  accuracy numeric default 0,
  correct int default 0,
  wrong int default 0,
  created_at timestamptz default now()
);

create index if not exists idx_typing_rankings on public.typing_rankings (wpm desc);

create table if not exists public.devices (
  device_id text primary key,
  email text default '',
  last_ping timestamptz default now()
);

create index if not exists idx_devices_ping on public.devices (last_ping desc);

alter table public.memos enable row level security;
alter table public.typing_rankings enable row level security;
alter table public.devices enable row level security;

drop policy if exists "memos public all" on public.memos;
drop policy if exists "typing_rankings public all" on public.typing_rankings;
drop policy if exists "devices public all" on public.devices;

create policy "memos public all" on public.memos for all using (true) with check (true);
create policy "typing_rankings public all" on public.typing_rankings for all using (true) with check (true);
create policy "devices public all" on public.devices for all using (true) with check (true);