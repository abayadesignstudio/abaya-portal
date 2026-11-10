-- Phases follow their dates: once today reaches a phase's start it's "in progress"; once its end has passed it's "complete".
-- Only ever moves forward (never undoes a phase someone marked complete early) and leaves "paused" alone.
create or replace function private.phase_status_for(cur public.phase_status, s date, e date)
returns public.phase_status language sql stable set search_path = '' as $$
  select case
    when cur = 'paused' or s is null or e is null then cur
    when e < (now() at time zone 'America/Chicago')::date then 'complete'::public.phase_status
    when s <= (now() at time zone 'America/Chicago')::date and cur = 'not_started' then 'in_progress'::public.phase_status
    else cur end
$$;

create or replace function private.phase_status_on_dates() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.status := private.phase_status_for(new.status, new.start_date, new.end_date);
  return new;
end $$;
drop trigger if exists phase_status_on_dates on public.phases;
create trigger phase_status_on_dates before insert or update of start_date, end_date on public.phases
  for each row execute function private.phase_status_on_dates();

create or replace function private.advance_phase_statuses() returns void
language sql security definer set search_path = '' as $$
  update public.phases set status = private.phase_status_for(status, start_date, end_date)
  where status <> private.phase_status_for(status, start_date, end_date)
$$;
revoke all on function private.advance_phase_statuses() from public, anon, authenticated;
select cron.schedule('abaya-phase-status', '7 6 * * *', $$select private.advance_phase_statuses()$$);
select private.advance_phase_statuses();
