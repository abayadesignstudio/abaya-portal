-- Contract scope shown to clients
create table public.contract_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  phase_id uuid references public.phases(id) on delete set null,
  title text not null,
  status text not null default 'not_started' check (status in ('not_started','in_progress','complete')),
  sort int not null default 0
);
-- Meetings held (count against phases.meetings_included)
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  phase_id uuid references public.phases(id) on delete set null,
  held_on date not null default current_date,
  title text,
  update_id uuid references public.updates(id) on delete set null
);
-- Client requests for additional services
create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid references public.profiles(id),
  description text not null,
  status text not null default 'requested' check (status in ('requested','quoted','approved','declined','done')),
  quote numeric(12,2),
  created_at timestamptz not null default now()
);
-- Calendar events created in the portal (synced to Google later)
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  starts_on date not null,
  ends_on date not null,
  start_time time,
  google_event_id text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
-- Proposals / agreements (document state stored as JSON)
create table public.agreements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  title text not null,
  status text not null default 'draft' check (status in ('draft','sent','signed','void')),
  doc jsonb not null default '{}',
  total_fee numeric(12,2),
  sent_at timestamptz,
  signed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Firm-wide settings (single row)
create table public.firm_settings (
  id int primary key default 1 check (id = 1),
  digest_time time not null default '18:00',
  digest_enabled boolean not null default true,
  reminder_days int[] not null default '{0,7,14,21}',
  late_rate_monthly numeric(5,2) not null default 2.00
);
insert into public.firm_settings (id) values (1) on conflict do nothing;

do $$ declare t text; begin
  foreach t in array array['contract_items','meetings','service_requests','calendar_events','agreements','firm_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "staff all" on public.%I for all to authenticated using (private.is_staff()) with check (private.is_staff())', t);
  end loop;
end $$;
create policy "client reads contract items" on public.contract_items for select to authenticated using (private.client_can_see_project(project_id));
create policy "client reads meetings" on public.meetings for select to authenticated using (private.client_can_see_project(project_id));
create policy "client reads own requests" on public.service_requests for select to authenticated using (private.client_can_see_project(project_id));
create policy "client creates requests" on public.service_requests for insert to authenticated
  with check (private.client_can_see_project(project_id) and requested_by = auth.uid() and status = 'requested');
create policy "client reads sent agreements" on public.agreements for select to authenticated
  using (client_id = private.my_client_id() and status in ('sent','signed'));
-- clients read the timelines of their own drawings' phases already via phases policy
