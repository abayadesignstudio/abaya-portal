-- Each person's own "Custom" sort order for the Projects page (drag rows to arrange). One row per person.
create table public.project_order (
  profile_id uuid primary key references public.profiles(id) on delete cascade default auth.uid(),
  project_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.project_order enable row level security;
create policy "own order read"   on public.project_order for select to authenticated using (profile_id = (select auth.uid()) and (select private.is_staff()));
create policy "own order add"    on public.project_order for insert to authenticated with check (profile_id = (select auth.uid()) and (select private.is_staff()));
create policy "own order change" on public.project_order for update to authenticated using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()) and (select private.is_staff()));
grant select, insert, update on public.project_order to authenticated;
