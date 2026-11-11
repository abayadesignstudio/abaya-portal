-- Duplicate a project: its settings, phases (fees, billing, order, meetings), phase team and budgeted hours, project team,
-- contracted deliverables and trades/consultants. Not copied: time, invoices, drawings, files, updates, agreements, additional services.
create or replace function public.duplicate_project(p_id uuid, p_number text, p_name text, p_keep_dates boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare src public.projects; nid uuid; ph record; nph uuid; map jsonb := '{}';
begin
  if not private.is_staff() then raise exception 'Staff only'; end if;
  select * into src from projects where id = p_id;
  if src.id is null then raise exception 'Project not found'; end if;
  if coalesce(trim(p_number), '') = '' or coalesce(trim(p_name), '') = '' then raise exception 'Enter a number and a name'; end if;
  if exists (select 1 from projects where lower(number) = lower(trim(p_number))) then raise exception 'Project number % is already used', trim(p_number); end if;
  insert into projects (number, name, client_id, category, categories, sector, status, address, outside_firm)
  values (trim(p_number), trim(p_name), src.client_id, src.category, src.categories, src.sector, 'active', src.address, src.outside_firm) returning id into nid;
  for ph in select * from phases where project_id = p_id and service_id is null and code <> 'AS' loop
    insert into phases (project_id, code, name, fee, fee_pct, billing, meetings_included, sort, status, start_date, end_date)
    values (nid, ph.code, ph.name, ph.fee, ph.fee_pct, ph.billing, ph.meetings_included, ph.sort, 'not_started',
      case when p_keep_dates then ph.start_date end, case when p_keep_dates then ph.end_date end) returning id into nph;
    map := map || jsonb_build_object(ph.id::text, nph::text);
  end loop;
  insert into phase_allocations (phase_id, profile_id, hours)
    select (map->>a.phase_id::text)::uuid, a.profile_id, a.hours from phase_allocations a where map ? a.phase_id::text;
  insert into project_members (project_id, profile_id, role_label, bill_rate, rate_id)
    select nid, profile_id, role_label, bill_rate, rate_id from project_members where project_id = p_id;
  insert into contract_items (project_id, phase_id, title, status, sort)
    select nid, (map->>phase_id::text)::uuid, title, 'not_started', sort from contract_items where project_id = p_id;
  insert into project_contacts (project_id, contact_id, trade, show_to_client)
    select nid, contact_id, trade, show_to_client from project_contacts where project_id = p_id;
  return nid;
end $$;
revoke all on function public.duplicate_project(uuid, text, text, boolean) from public, anon;
grant execute on function public.duplicate_project(uuid, text, text, boolean) to authenticated;
