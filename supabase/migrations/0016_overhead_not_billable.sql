-- Time logged to the Overhead project (OH) is never billable. New entries default to billable, so this
-- trigger flips them, and the update corrects the entries already saved that way.
create or replace function private.time_entry_overhead_not_billable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.billable and exists (select 1 from public.projects p where p.id = new.project_id and p.number = 'OH') then
    new.billable := false;
  end if;
  return new;
end $$;
drop trigger if exists time_entry_overhead_not_billable on public.time_entries;
create trigger time_entry_overhead_not_billable before insert or update of billable, project_id on public.time_entries
  for each row execute function private.time_entry_overhead_not_billable();
update public.time_entries t set billable = false
  from public.projects p where p.id = t.project_id and p.number = 'OH' and t.billable;
