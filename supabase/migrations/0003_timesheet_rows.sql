create table public.timesheet_rows (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  phase_id uuid references public.phases(id) on delete cascade,
  role_label text,
  activity text,
  created_at timestamptz not null default now()
);
create unique index timesheet_rows_key on public.timesheet_rows (profile_id, project_id, coalesce(phase_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(activity, ''));
alter table public.timesheet_rows enable row level security;
create policy "own rows" on public.timesheet_rows for all to authenticated
  using (profile_id = auth.uid() and private.is_staff()) with check (profile_id = auth.uid() and private.is_staff());
insert into public.projects (number, name, sector, status) values ('OH', 'Overhead', 'internal', 'active') on conflict (number) do nothing;
