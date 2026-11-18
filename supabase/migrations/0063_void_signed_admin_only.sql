-- 0063 Only an admin can void a signed agreement (voiding unlocks its phases); signed agreements can't be deleted.
create or replace function private.lock_agreement() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status in ('sent','signed') and new.doc is distinct from old.doc then
    raise exception 'This agreement is published and locked. Unpublish it to edit.';
  end if;
  if old.status = 'signed' and new.status not in ('signed','void') then
    raise exception 'A signed agreement can only be voided.';
  end if;
  if old.status = 'signed' and new.status = 'void' and not private.is_admin() then
    raise exception 'Only an admin can void a signed agreement.';
  end if;
  return new;
end $$;

create or replace function private.no_delete_signed_agreement() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'signed' then raise exception 'A signed agreement can''t be deleted. An admin can void it instead.'; end if;
  return old;
end $$;
drop trigger if exists agreements_no_delete_signed on public.agreements;
create trigger agreements_no_delete_signed before delete on public.agreements for each row execute function private.no_delete_signed_agreement();
