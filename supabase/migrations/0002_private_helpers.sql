-- Keep helper functions out of the public API
create schema if not exists private;
grant usage on schema private to authenticated;
alter function public.my_role() set schema private;
alter function public.is_staff() set schema private;
alter function public.is_admin() set schema private;
alter function public.my_client_id() set schema private;
alter function public.client_can_see_project(uuid) set schema private;
alter function public.handle_new_user() set schema private;
alter function public.guard_profile_update() set schema private;

-- the bodies reference public.* names; repoint them
create or replace function private.is_staff() returns boolean language sql stable security definer set search_path = '' as $$ select private.my_role() in ('admin','staff') $$;
create or replace function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$ select private.my_role() = 'admin' $$;
create or replace function private.client_can_see_project(p uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projects where id = p and client_id = private.my_client_id()) $$;
create or replace function private.guard_profile_update() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() and (new.role is distinct from old.role or new.client_id is distinct from old.client_id
      or new.util_target is distinct from old.util_target or new.bill_rate is distinct from old.bill_rate) then
    raise exception 'Only an admin can change role, client, target or rate';
  end if;
  return new;
end $$;

revoke all on all functions in schema private from public, anon;
grant execute on function private.my_role(), private.is_staff(), private.is_admin(), private.my_client_id(), private.client_can_see_project(uuid) to authenticated;
revoke all on function private.handle_new_user(), private.guard_profile_update() from authenticated;
