-- Past weeks lock. Once a week (Mon–Sun, Central time) has passed, its time entries can't be added, changed or deleted
-- until an admin unlocks that week for that person. An unlock lasts 24 hours or until it is locked again.
-- Billing (invoice_id, bill_rate) and server jobs are not affected.
create table if not exists public.time_unlocks (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  unlocked_by uuid references public.profiles(id) on delete set null default auth.uid(),
  unlocked_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  primary key (profile_id, week_start)
);
alter table public.time_unlocks enable row level security;
create policy "staff read unlocks" on public.time_unlocks for select to authenticated using ((select private.is_staff()));
create policy "admins unlock" on public.time_unlocks for insert to authenticated with check ((select private.is_admin()));
create policy "admins change unlock" on public.time_unlocks for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admins relock" on public.time_unlocks for delete to authenticated using ((select private.is_admin()));
grant select, insert, update, delete on public.time_unlocks to authenticated;

create or replace function public.week_of(d date) returns date language sql immutable as $$ select (d - ((extract(isodow from d)::int) - 1))::date $$;

create or replace function private.time_week_open(p_profile uuid, d date) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.week_of(d) >= public.week_of((now() at time zone 'America/Chicago')::date)
      or exists (select 1 from public.time_unlocks u where u.profile_id = p_profile and u.week_start = public.week_of(d) and u.expires_at > now())
$$;

create or replace function private.guard_time_lock() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return coalesce(new, old); end if; -- server jobs, imports, migrations
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'invoice_id' - 'bill_rate') = (to_jsonb(old) - 'invoice_id' - 'bill_rate') then return new; end if; -- billing only
  if tg_op in ('UPDATE', 'DELETE') and not private.time_week_open(old.profile_id, old.work_date) then
    raise exception 'The week of % is locked. Ask an admin to unlock it to make changes.', to_char(public.week_of(old.work_date), 'Mon DD') using errcode = 'P0001';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and not private.time_week_open(new.profile_id, new.work_date) then
    raise exception 'The week of % is locked. Ask an admin to unlock it to make changes.', to_char(public.week_of(new.work_date), 'Mon DD') using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists guard_time_lock on public.time_entries;
create trigger guard_time_lock before insert or update or delete on public.time_entries for each row execute function private.guard_time_lock();
