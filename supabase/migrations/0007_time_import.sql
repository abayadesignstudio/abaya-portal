-- Monograph time-log import support.
-- Imported "Past Hours" entries are weekly lumps, so the 24h cap is relaxed for source='monograph'.
alter table public.time_entries
  add column if not exists source text,
  add column if not exists legacy_phase text;

alter table public.time_entries drop constraint if exists time_entries_minutes_check;
alter table public.time_entries add constraint time_entries_minutes_check
  check (minutes > 0 and (minutes <= 24 * 60 or source = 'monograph'));

-- Hours for staff who have not signed in yet wait here, keyed by email.
create table if not exists private.pending_time_entries (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  phase_id uuid references public.phases(id) on delete set null,
  work_date date not null,
  minutes integer not null,
  role_label text,
  activity text,
  note text,
  billable boolean not null default true,
  legacy_phase text,
  source text
);
create index if not exists pending_time_entries_email on private.pending_time_entries (lower(email));

-- On first sign-in, create the profile, then move any waiting hours onto it.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare inv public.invites;
begin
  select * into inv from public.invites where lower(email) = lower(new.email);
  insert into public.profiles (id, email, full_name, role, client_id)
  values (new.id, new.email, inv.full_name, coalesce(inv.role, 'none'), inv.client_id);

  insert into public.time_entries (profile_id, project_id, phase_id, work_date, minutes, role_label, activity, note, billable, legacy_phase, source)
  select new.id, project_id, phase_id, work_date, minutes, role_label, activity, note, billable, legacy_phase, source
  from private.pending_time_entries where lower(email) = lower(new.email);
  delete from private.pending_time_entries where lower(email) = lower(new.email);
  return new;
end $$;
