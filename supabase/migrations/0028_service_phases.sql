-- Approved additional services get a phase line (code AS) so time, budget and billing work like any phase.
alter table public.phases
  add column if not exists name text,
  add column if not exists parent_phase_id uuid references public.phases(id) on delete set null,
  add column if not exists service_id uuid unique;
alter table public.service_requests add column if not exists phase_id uuid references public.phases(id) on delete set null;
alter table public.phases add constraint phases_service_id_fkey foreign key (service_id) references public.service_requests(id) on delete cascade;

-- one row per standard phase per project; any number of service lines
alter table public.phases drop constraint if exists phases_project_id_code_key;
create unique index if not exists phases_project_code_main on public.phases (project_id, code) where service_id is null;
create index if not exists phases_parent_idx on public.phases (parent_phase_id);
create index if not exists service_requests_phase_idx on public.service_requests (phase_id);

create or replace function private.sync_service_phase() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ph uuid;
begin
  select id into ph from public.phases where service_id = new.id;
  if new.status in ('approved', 'done') then
    if ph is null then
      insert into public.phases (project_id, code, name, fee, status, parent_phase_id, service_id)
      values (new.project_id, 'AS', new.description, coalesce(new.quote, 0),
              (case when new.status = 'done' then 'complete' else 'in_progress' end)::public.phase_status, new.phase_id, new.id);
    else
      update public.phases set name = new.description, fee = coalesce(new.quote, 0), parent_phase_id = new.phase_id,
        status = case when new.status = 'done' then 'complete'::public.phase_status
                      when status = 'complete' then 'in_progress'::public.phase_status else status end
      where id = ph;
    end if;
  elsif ph is not null then
    -- no longer approved: remove the line unless time or billing already points at it
    if not exists (select 1 from public.time_entries where phase_id = ph)
       and not exists (select 1 from public.invoice_lines where phase_id = ph) then
      delete from public.phases where id = ph;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.sync_service_phase() from public;

drop trigger if exists service_phase_sync on public.service_requests;
create trigger service_phase_sync after insert or update of status, quote, description, phase_id on public.service_requests
  for each row execute function private.sync_service_phase();
