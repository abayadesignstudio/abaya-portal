-- Link a Google Calendar meeting (shown on the portal calendar) to a portal project.
-- Google events aren't stored in the portal; this keeps only the event id → project choice.
create table public.calendar_event_projects (
  google_event_id text primary key,
  project_id uuid references public.projects(id) on delete cascade,  -- null = "no project" (overrides the automatic match)
  set_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.calendar_event_projects enable row level security;
create policy "staff read event links"   on public.calendar_event_projects for select to authenticated using ((select private.is_staff()));
create policy "staff add event links"    on public.calendar_event_projects for insert to authenticated with check ((select private.is_staff()));
create policy "staff change event links" on public.calendar_event_projects for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy "staff remove event links" on public.calendar_event_projects for delete to authenticated using ((select private.is_staff()));
grant select, insert, update, delete on public.calendar_event_projects to authenticated;
