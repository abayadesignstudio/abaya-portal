-- Contact library: everyone the firm works with (GCs, engineers, consultants…), stored once.
-- A project's Contacts tab links people from the library (project_contacts → contacts) with their role on that project.
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  name text, company text, trade text not null default 'Other',
  email text, phone text, notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (coalesce(trim(name), '') <> '' or coalesce(trim(company), '') <> '')
);
create unique index contacts_email_unique on public.contacts (lower(email)) where email is not null and email <> '';
alter table public.contacts enable row level security;
create policy "staff all" on public.contacts for all to authenticated using (private.is_staff()) with check (private.is_staff());

-- project_contacts had no rows yet: it now only links a library contact to a project
alter table public.project_contacts drop column name, drop column company, drop column email, drop column phone, drop column notes;
alter table public.project_contacts add column contact_id uuid not null references public.contacts(id) on delete cascade;
create unique index project_contacts_once on public.project_contacts (project_id, contact_id);

-- the client sees the library entries of the people shown on their project team
create policy "client reads shown team" on public.contacts for select to authenticated using (exists (
  select 1 from public.project_contacts pc join public.projects p on p.id = pc.project_id
  where pc.contact_id = contacts.id and pc.show_to_client and p.client_id = private.my_client_id()));

-- client contacts get a phone number too
alter table public.client_contacts add column if not exists phone text;
