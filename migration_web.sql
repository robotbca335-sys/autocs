-- AUTO RELAX WEB - migration tambahan (apply di Supabase SQL console prod)
-- Tambahan: memos + typing_rankings + devices (untuk tab Memo, Typing Test, online stats)

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