-- Each employee's standard role and billable rate come from the firm rate table (Settings → Billable rates).
-- profiles.rate_id picks the level; title and bill_rate follow it, and change when that level's rate changes.
alter table public.profiles add column if not exists rate_id uuid references public.billing_rates(id) on delete set null;
create index if not exists profiles_rate_idx on public.profiles (rate_id);

create or replace function private.profile_rate_from_level()
returns trigger language plpgsql set search_path = '' as $$
declare r public.billing_rates;
begin
  if new.rate_id is not null and (tg_op = 'INSERT' or new.rate_id is distinct from old.rate_id) then
    select * into r from public.billing_rates where id = new.rate_id;
    if found then new.title := r.role; new.bill_rate := r.rate; end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_rate_level on public.profiles;
create trigger profiles_rate_level before insert or update on public.profiles
  for each row execute function private.profile_rate_from_level();

-- a level's new rate or role name reaches everyone on it
create or replace function private.rate_level_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.rate is distinct from old.rate or new.role is distinct from old.role then
    update public.profiles set bill_rate = new.rate, title = new.role where rate_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists billing_rates_reach_profiles on public.billing_rates;
create trigger billing_rates_reach_profiles after update on public.billing_rates
  for each row execute function private.rate_level_changed();

-- non-admins can't pick their own level either
create or replace function private.guard_profile_admin_fields()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null or (select private.is_admin()) then return new; end if;
  if new.role is distinct from old.role or new.client_id is distinct from old.client_id or new.email is distinct from old.email
     or new.bill_rate is distinct from old.bill_rate or new.util_target is distinct from old.util_target or new.title is distinct from old.title
     or new.rate_id is distinct from old.rate_id then
    raise exception 'Only an admin can change roles, rates, utilization targets or titles.' using errcode = '42501';
  end if;
  return new;
end $$;

-- current people: match the level whose role and rate they already have
update public.profiles p set rate_id = b.id
from public.billing_rates b
where p.rate_id is null and p.role in ('admin', 'staff') and p.bill_rate = b.rate
  and b.id = (select id from public.billing_rates x where x.rate = p.bill_rate order by sort, level limit 1);
