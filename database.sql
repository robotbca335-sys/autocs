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
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_claims_user on public.claims (user_id);
create index if not exists idx_claims_status on public.claims (status);

-- Kode tiket UNIQUE: sekali diklaim, tidak bisa dipakai lagi (anti double-claim / race condition)
create unique index if not exists idx_claims_tiket_unique on public.claims (kode_tiket);

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
alter table public.logs enable row level security;

drop policy if exists "sites public read" on public.sites;
drop policy if exists "claims public all" on public.claims;
drop policy if exists "logs public readonly" on public.logs;

create policy "sites public read" on public.sites for select using (true);
create policy "claims public all" on public.claims for all using (true) with check (true);
create policy "logs public readonly" on public.logs for select using (true);