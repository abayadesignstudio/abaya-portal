-- A status someone picks by hand sticks: the date rule (0033) no longer overrides it, and the nightly job skips it.
-- Changing a phase's dates (without touching its status) hands it back to the date rule.
alter table public.phases add column if not exists status_manual boolean not null default false;

create or replace function private.phase_status_on_dates() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status and (select auth.uid()) is not null then
    new.status_manual := true;            -- chosen by a person: keep it
    return new;
  end if;
  if tg_op = 'INSERT' or new.start_date is distinct from old.start_date or new.end_date is distinct from old.end_date then
    new.status_manual := false;           -- new dates: follow them again
    new.status := private.phase_status_for(new.status, new.start_date, new.end_date);
  end if;
  return new;
end $$;
drop trigger if exists phase_status_on_dates on public.phases;
create trigger phase_status_on_dates before insert or update of start_date, end_date, status on public.phases
  for each row execute function private.phase_status_on_dates();

create or replace function private.advance_phase_statuses() returns void
language sql security definer set search_path = '' as $$
  update public.phases set status = private.phase_status_for(status, start_date, end_date)
  where not status_manual and status <> private.phase_status_for(status, start_date, end_date)
$$;
revoke all on function private.advance_phase_statuses() from public, anon, authenticated;
