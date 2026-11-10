-- Which calendars each person shows in the Today sidebar and on the Home calendar (keys: 'tasks', 'marks', 'bills', 'g:<profile id>', 'pc:<personal calendar id>').
create table public.calendar_prefs (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  hide_today text[] not null default '{}',
  hide_cal text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.calendar_prefs enable row level security;
create policy "own prefs" on public.calendar_prefs for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
