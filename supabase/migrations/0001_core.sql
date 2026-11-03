-- Abaya Design Studio portal — core schema
create extension if not exists pgcrypto;

-- ---------- enums
create type public.user_role as enum ('admin','staff','client','none');
create type public.project_category as enum ('S','FO','CON');
create type public.project_sector as enum ('commercial','residential','medical','consultation','civic','internal');
create type public.project_status as enum ('active','paused','complete','proposal');
create type public.phase_code as enum ('CE','SD','DD','CD','BN','PM','CA');
create type public.phase_status as enum ('not_started','in_progress','paused','complete');
create type public.invoice_status as enum ('draft','open','paid','void','uncollectible');
create type public.line_kind as enum ('phase','expense','markup','late','retainer','tax','credit','other');

-- ---------- people
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  billing_email text,
  phone text,
  address text,
  stripe_customer_id text unique,
  monograph_ref text,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  initials text,
  title text,
  role public.user_role not null default 'none',
  client_id uuid references public.clients(id) on delete set null,
  util_target numeric(5,2),
  bill_rate numeric(10,2),
  google_calendar_id text,
  created_at timestamptz not null default now()
);

-- who may sign in, and as what (sign-in is invite only)
create table public.invites (
  email text primary key,
  role public.user_role not null check (role <> 'none'),
  full_name text,
  client_id uuid references public.clients(id) on delete cascade,
  invited_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((role = 'client') = (client_id is not null))
);

create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text,
  email text not null,
  receives_invoices boolean not null default true,
  receives_updates boolean not null default true,
  unique (client_id, email)
);

-- ---------- projects
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  name text not null,
  client_id uuid references public.clients(id) on delete restrict,
  category public.project_category,
  sector public.project_sector,
  status public.project_status not null default 'active',
  address text,
  next_milestone text,
  monograph_ref text,
  created_at timestamptz not null default now()
);

create table public.phases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  code public.phase_code not null,
  fee numeric(12,2) not null default 0,
  status public.phase_status not null default 'not_started',
  start_date date,
  end_date date,
  meetings_included int,
  unique (project_id, code)
);

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_label text,
  bill_rate numeric(10,2),
  primary key (project_id, profile_id)
);

create table public.phase_allocations (
  phase_id uuid not null references public.phases(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  hours numeric(8,2) not null default 0,
  primary key (phase_id, profile_id)
);

-- ---------- time
create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete restrict,
  phase_id uuid references public.phases(id) on delete set null,
  work_date date not null,
  minutes int not null check (minutes > 0 and minutes <= 24*60),
  role_label text,
  activity text,
  note text,
  billable boolean not null default true,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.time_entries (profile_id, work_date);
create index on public.time_entries (project_id);

create table public.timers (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  phase_id uuid references public.phases(id) on delete set null,
  role_label text,
  activity text,
  note text,
  started_at timestamptz not null default now(),
  banked_minutes int not null default 0
);

-- ---------- money
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  description text not null,
  amount numeric(12,2) not null,
  spent_on date not null default current_date,
  reimbursable boolean not null default true,
  invoice_id uuid,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  project_id uuid not null references public.projects(id) on delete restrict,
  client_id uuid references public.clients(id) on delete restrict,
  status public.invoice_status not null default 'draft',
  period_start date,
  period_end date,
  issue_date date,
  terms_days int not null default 0,
  due_date date,
  subtotal numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  note text,
  allow_card boolean not null default true,
  allow_ach boolean not null default true,
  pass_card_fee boolean not null default false,
  pass_ach_fee boolean not null default false,
  reminders boolean not null default true,
  hold_drawings boolean not null default true,
  stripe_invoice_id text unique,
  hosted_url text,
  pdf_url text,
  view_token uuid not null default gen_random_uuid() unique,
  sent_at timestamptz,
  paid_at timestamptz,
  payment_method text,
  monograph_ref text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.expenses add constraint expenses_invoice_fk foreign key (invoice_id) references public.invoices(id) on delete set null;

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  kind public.line_kind not null,
  phase_id uuid references public.phases(id) on delete set null,
  description text not null,
  pct_to_date numeric(6,2),
  amount numeric(12,2) not null,
  sort int not null default 0
);

create table public.invoice_recipients (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  email text not null,
  kind text not null default 'to' check (kind in ('to','cc')),
  track_token uuid not null default gen_random_uuid() unique
);

create table public.invoice_events (
  id bigint generated always as identity primary key,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  kind text not null check (kind in ('created','sent','delivered','bounced','opened','viewed','reminder','payment_started','paid','payment_failed','voided','note')),
  recipient text,
  actor uuid references public.profiles(id),
  detail text,
  at timestamptz not null default now()
);
create index on public.invoice_events (invoice_id, at);

-- ---------- client-facing project content
create table public.drawings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  phase_id uuid references public.phases(id) on delete set null,
  title text not null,
  sheet_count int,
  issued_on date not null default current_date,
  storage_path text not null,
  locked_until_invoice uuid references public.invoices(id) on delete set null,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author uuid references public.profiles(id),
  kind text not null default 'memo' check (kind in ('memo','photos','list','meeting','change')),
  title text,
  body text,
  items jsonb not null default '[]',
  photo_paths text[] not null default '{}',
  visible_to_client boolean not null default true,
  notify text not null default 'digest' check (notify in ('digest','now','none')),
  created_at timestamptz not null default now()
);

create table public.notifications (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  text text not null,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (profile_id, created_at desc);

create table public.deliverables (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  phase_id uuid references public.phases(id) on delete set null,
  title text not null,
  assignee uuid references public.profiles(id) on delete set null,
  due_date date,
  status text not null default 'todo' check (status in ('todo','in_progress','in_review','done')),
  created_at timestamptz not null default now()
);

-- ---------- helpers (security definer so policies don't recurse)
create or replace function public.my_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'none'::public.user_role)
$$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_role() in ('admin','staff')
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_role() = 'admin'
$$;
create or replace function public.my_client_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select client_id from public.profiles where id = auth.uid() and role = 'client'
$$;
create or replace function public.client_can_see_project(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projects where id = p and client_id = public.my_client_id())
$$;

-- new auth users get a profile only if invited
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inv public.invites;
begin
  select * into inv from public.invites where lower(email) = lower(new.email);
  insert into public.profiles (id, email, full_name, role, client_id)
  values (new.id, new.email, inv.full_name, coalesce(inv.role, 'none'), inv.client_id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- only admins change roles; users may edit their own name/initials
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() and (new.role is distinct from old.role or new.client_id is distinct from old.client_id
      or new.util_target is distinct from old.util_target or new.bill_rate is distinct from old.bill_rate) then
    raise exception 'Only an admin can change role, client, target or rate';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------- row level security
do $$ declare t text; begin
  foreach t in array array['clients','profiles','invites','client_contacts','projects','phases','project_members','phase_allocations',
    'time_entries','timers','expenses','invoices','invoice_lines','invoice_recipients','invoice_events','drawings','updates','notifications','deliverables']
  loop execute format('alter table public.%I enable row level security', t); end loop;
end $$;

-- staff: full access to firm data
do $$ declare t text; begin
  foreach t in array array['clients','client_contacts','projects','phases','project_members','phase_allocations',
    'expenses','invoices','invoice_lines','invoice_recipients','invoice_events','drawings','updates','deliverables']
  loop execute format('create policy "staff all" on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t); end loop;
end $$;

-- profiles
create policy "read self or staff reads all" on public.profiles for select to authenticated using (id = auth.uid() or public.is_staff());
create policy "edit self" on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy "admin manage invites" on public.invites for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- time: staff see all time, edit only their own (admin edits any)
create policy "staff read time" on public.time_entries for select to authenticated using (public.is_staff());
create policy "own time write" on public.time_entries for insert to authenticated with check (public.is_staff() and (profile_id = auth.uid() or public.is_admin()));
create policy "own time update" on public.time_entries for update to authenticated using (profile_id = auth.uid() or public.is_admin()) with check (profile_id = auth.uid() or public.is_admin());
create policy "own time delete" on public.time_entries for delete to authenticated using (profile_id = auth.uid() or public.is_admin());
create policy "own timer" on public.timers for all to authenticated using (profile_id = auth.uid() and public.is_staff()) with check (profile_id = auth.uid() and public.is_staff());

-- notifications: own only
create policy "own notifications read" on public.notifications for select to authenticated using (profile_id = auth.uid());
create policy "own notifications mark" on public.notifications for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- clients: read-only view of their own projects
create policy "client reads own client" on public.clients for select to authenticated using (id = public.my_client_id());
create policy "client reads projects" on public.projects for select to authenticated using (client_id = public.my_client_id());
create policy "client reads phases" on public.phases for select to authenticated using (public.client_can_see_project(project_id));
create policy "client reads sent invoices" on public.invoices for select to authenticated using (client_id = public.my_client_id() and status <> 'draft');
create policy "client reads invoice lines" on public.invoice_lines for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and i.client_id = public.my_client_id() and i.status <> 'draft'));
create policy "client reads drawing list" on public.drawings for select to authenticated using (public.client_can_see_project(project_id));
create policy "client reads visible updates" on public.updates for select to authenticated using (visible_to_client and public.client_can_see_project(project_id));

-- ---------- storage: private buckets; drawing files are only handed out by the drawing-url function
insert into storage.buckets (id, name, public) values ('drawings','drawings', false), ('photos','photos', false), ('models','models', false)
  on conflict (id) do nothing;
create policy "staff manage files" on storage.objects for all to authenticated
  using (bucket_id in ('drawings','photos','models') and public.is_staff())
  with check (bucket_id in ('drawings','photos','models') and public.is_staff());
create policy "client reads own photos and models" on storage.objects for select to authenticated
  using (bucket_id in ('photos','models') and public.client_can_see_project(((storage.foldername(name))[1])::uuid));

-- ---------- reporting views (security_invoker so RLS applies)
create view public.phase_billing with (security_invoker = true) as
select ph.id as phase_id, ph.project_id, ph.code, ph.fee,
  coalesce(sum(l.amount) filter (where i.status in ('open','paid')), 0) as billed
from public.phases ph
left join public.invoice_lines l on l.phase_id = ph.id and l.kind = 'phase'
left join public.invoices i on i.id = l.invoice_id
group by ph.id;

create view public.invoice_summary with (security_invoker = true) as
select i.*, p.number as project_number, p.name as project_name, p.sector, c.name as client_name,
  (select e.kind from public.invoice_events e where e.invoice_id = i.id and e.kind in ('viewed','opened','paid','payment_started') order by
     case e.kind when 'paid' then 1 when 'payment_started' then 2 when 'viewed' then 3 else 4 end, e.at desc limit 1) as best_activity,
  case when i.status = 'open' and i.due_date < current_date then current_date - i.due_date else 0 end as days_past_due
from public.invoices i join public.projects p on p.id = i.project_id left join public.clients c on c.id = i.client_id;
