-- GPS trips (mileage + site stops) and recorded client conversations (transcribed + summarized).

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  miles numeric(8,2) not null default 0,
  stops jsonb not null default '[]',     -- [{lat, lng, address, arrived, left}]
  route jsonb not null default '[]',     -- simplified [[lat, lng, epochSeconds], …]
  expense_id uuid references public.expenses(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.trips enable row level security;
create policy "own trips" on public.trips for all to authenticated
  using (profile_id = auth.uid() or private.is_admin()) with check (profile_id = auth.uid() and private.is_staff());
create index if not exists trips_profile on public.trips (profile_id, started_at desc);

create table if not exists public.recordings (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  path text not null,                    -- storage: recordings/<profile_id>/<uuid>.<ext>
  seconds integer,
  purpose text not null default 'conversation' check (purpose in ('conversation','dictation')),
  status text not null default 'uploaded' check (status in ('uploaded','transcribing','done','error')),
  transcript text,
  summary text,
  error text,
  update_id uuid references public.updates(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.recordings enable row level security;
create policy "own recordings" on public.recordings for all to authenticated
  using (profile_id = auth.uid() or private.is_admin()) with check (profile_id = auth.uid() and private.is_staff());

insert into storage.buckets (id, name, public) values ('recordings', 'recordings', false) on conflict (id) do nothing;
create policy "staff upload own recordings" on storage.objects for insert to authenticated
  with check (bucket_id = 'recordings' and private.is_staff() and (storage.foldername(name))[1] = auth.uid()::text);
create policy "read own recordings" on storage.objects for select to authenticated
  using (bucket_id = 'recordings' and ((storage.foldername(name))[1] = auth.uid()::text or private.is_admin()));
create policy "delete own recordings" on storage.objects for delete to authenticated
  using (bucket_id = 'recordings' and ((storage.foldername(name))[1] = auth.uid()::text or private.is_admin()));
