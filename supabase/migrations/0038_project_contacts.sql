-- Project contacts: the trades and consultants on a project (GC, engineers…). Staff manage them; the client sees the ones marked shown.
-- Emails and calendar meetings with them are logged as project updates by email-sync (meetings as kind 'event', deduped in event_log).
create table public.project_contacts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  trade text not null default 'Other',
  name text, company text, email text, phone text, notes text,
  show_to_client boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.project_contacts (project_id);
create index on public.project_contacts (lower(email));
alter table public.project_contacts enable row level security;
create policy "staff all" on public.project_contacts for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy "client reads shown contacts" on public.project_contacts for select to authenticated
  using (show_to_client and exists (select 1 from public.projects p where p.id = project_id and p.client_id = private.my_client_id()));

alter table public.updates drop constraint if exists updates_kind_check;
alter table public.updates add constraint updates_kind_check check (kind in ('memo','photos','list','meeting','change','email','event'));

create table public.event_log (
  event_key text primary key,
  project_id uuid references public.projects(id) on delete cascade,
  update_id uuid references public.updates(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.event_log enable row level security;
create policy "staff read" on public.event_log for select to authenticated using (private.is_staff());
