-- A person's other calendars (personal Gmail, iCloud, Outlook…) added by their private iCal link.
-- visibility: 'private' = only the owner sees it; 'busy' = coworkers see "Busy" blocks; 'details' = coworkers see titles too.
create table public.personal_calendars (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  label text not null default 'Personal',
  ics_url text not null check (ics_url ~* '^(https?|webcal)://'),
  visibility text not null default 'private' check (visibility in ('private', 'busy', 'details')),
  created_at timestamptz not null default now()
);
create index personal_calendars_profile_idx on public.personal_calendars (profile_id);
alter table public.personal_calendars enable row level security;
create policy "owner manages own calendars" on public.personal_calendars for all
  using (profile_id = (select auth.uid()) and private.is_staff())
  with check (profile_id = (select auth.uid()) and private.is_staff());
