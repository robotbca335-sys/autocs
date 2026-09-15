-- ============================================================
-- MIGRATION v2 - Kolom pipeline + tabel settings
-- JALANKAN DI SUPABASE SQL EDITOR (anon key TIDAK bisa DDL)
-- Idempotent: aman dijalankan berulang kali
-- ============================================================

-- 1) Tambah kolom baru ke tabel claims (hanya jika belum ada)
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name='claims' and column_name='betting_actual') then
    alter table public.claims add column betting_actual bigint default null;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='claims' and column_name='scatter_actual') then
    alter table public.claims add column scatter_actual int default null;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='claims' and column_name='hadiah_expected') then
    alter table public.claims add column hadiah_expected bigint default null;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='claims' and column_name='hadiah_actual') then
    alter table public.claims add column hadiah_actual bigint default null;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='claims' and column_name='payout') then
    alter table public.claims add column payout text default '';
  end if;
  if not exists (select 1 from information_schema.columns where table_name='claims' and column_name='reject_reason') then
    alter table public.claims add column reject_reason text default '';
  end if;
  if not exists (select 1 from information_schema.columns where table_name='claims' and column_name='check_attempts') then
    alter table public.claims add column check_attempts int default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='claims' and column_name='checked_at') then
    alter table public.claims add column checked_at timestamptz default null;
  end if;
end $$;

-- 2) Tabel settings (key -> value jsonb) jika belum ada
create table if not exists public.settings (
  key text primary key,
  value jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table public.settings enable row level security;
drop policy if exists "settings public all" on public.settings;
create policy "settings public all" on public.settings for all using (true) with check (true);

grant all on table public.settings to anon, authenticated, service_role;
grant all on table public.claims to anon, authenticated, service_role;