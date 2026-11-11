-- Additional services can be billed hourly: the choice is made on the service and carried to its phase line.
alter table public.service_requests add column if not exists billing text not null default 'fixed' check (billing in ('fixed', 'hourly'));

create or replace function private.sync_service_phase() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ph uuid;
begin
  select id into ph from public.phases where service_id = new.id;
  if new.status in ('approved', 'done') then
    if ph is null then
      insert into public.phases (project_id, code, name, fee, status, parent_phase_id, service_id, billing)
      values (new.project_id, 'AS', new.description, coalesce(new.quote, 0),
              (case when new.status = 'done' then 'complete' else 'in_progress' end)::public.phase_status, new.phase_id, new.id, new.billing);
    else
      update public.phases set name = new.description, fee = coalesce(new.quote, 0), parent_phase_id = new.phase_id, billing = new.billing,
        status = case when new.status = 'done' then 'complete'::public.phase_status
                      when status = 'complete' then 'in_progress'::public.phase_status else status end
      where id = ph;
    end if;
  elsif ph is not null then
    if not exists (select 1 from public.time_entries where phase_id = ph)
       and not exists (select 1 from public.invoice_lines where phase_id = ph) then
      delete from public.phases where id = ph;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.sync_service_phase() from public;
drop trigger if exists service_phase_sync on public.service_requests;
create trigger service_phase_sync after insert or update of status, quote, description, phase_id, billing on public.service_requests
  for each row execute function private.sync_service_phase();

-- Switching a service's phase line between fixed and hourly (Phases table ⋯ menu) updates the service too.
create or replace function private.phase_billing_to_service() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.service_id is not null and new.billing is distinct from old.billing then
    update public.service_requests set billing = new.billing where id = new.service_id and billing is distinct from new.billing;
  end if;
  return new;
end $$;
revoke all on function private.phase_billing_to_service() from public;
drop trigger if exists phase_billing_to_service on public.phases;
create trigger phase_billing_to_service after update of billing on public.phases for each row execute function private.phase_billing_to_service();
