-- Firm settings, rates, people and roles are set by admins only. Employees keep their own photo, name and calendar link.

-- firm_settings: everyone on staff reads, only admins write
drop policy if exists "staff all" on public.firm_settings;
create policy "staff read firm settings" on public.firm_settings for select to authenticated using ((select private.is_staff()));
create policy "admins change firm settings" on public.firm_settings for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- profiles: an employee may edit their own row, but not their role, client link, email, rate, utilization target or title
create or replace function private.guard_profile_admin_fields()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null or (select private.is_admin()) then return new; end if; -- server jobs and admins
  if new.role is distinct from old.role or new.client_id is distinct from old.client_id or new.email is distinct from old.email
     or new.bill_rate is distinct from old.bill_rate or new.util_target is distinct from old.util_target or new.title is distinct from old.title then
    raise exception 'Only an admin can change roles, rates, utilization targets or titles.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists profiles_admin_fields on public.profiles;
create trigger profiles_admin_fields before update on public.profiles
  for each row execute function private.guard_profile_admin_fields();
