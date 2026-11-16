-- More events land in Notifications (and so on the lock screen via web push):
--  • a task is assigned to you by someone else
--  • a client signs an agreement (admins)
--  • a client requests an additional service (admins)
create or replace function private.notify_task_assigned() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee is not null and new.assignee is distinct from coalesce(auth.uid(), new.created_by)
     and (tg_op = 'INSERT' or new.assignee is distinct from old.assignee) then
    insert into public.notifications (profile_id, kind, text, href)
    values (new.assignee, 'task', 'New task: ' || left(new.title, 120) || coalesce(' · due ' || to_char(new.due_on, 'Mon DD'), ''), '#/');
  end if;
  return new;
end $$;
revoke all on function private.notify_task_assigned() from public, anon, authenticated;
drop trigger if exists notify_task_assigned on public.tasks;
create trigger notify_task_assigned after insert or update of assignee on public.tasks for each row execute function private.notify_task_assigned();

create or replace function private.notify_agreement_signed() returns trigger language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  select title into t from public.agreements where id = new.agreement_id;
  insert into public.notifications (profile_id, kind, text, href)
  select p.id, 'agreement', coalesce(new.signer_name, 'The client') || ' signed ' || coalesce(t, 'an agreement'), '#/proposals/' || new.agreement_id
  from public.profiles p where p.role = 'admin';
  return new;
end $$;
revoke all on function private.notify_agreement_signed() from public, anon, authenticated;
drop trigger if exists notify_agreement_signed on public.agreement_signatures;
create trigger notify_agreement_signed after insert on public.agreement_signatures for each row execute function private.notify_agreement_signed();

create or replace function private.notify_service_request() returns trigger language plpgsql security definer set search_path = '' as $$
declare pn text;
begin
  if exists (select 1 from public.profiles where id = new.requested_by and role = 'client') then
    select number || ' ' || name into pn from public.projects where id = new.project_id;
    insert into public.notifications (profile_id, kind, text, href)
    select p.id, 'request', 'Service request on ' || coalesce(pn, 'a project') || ': ' || left(new.description, 100), '#/projects/' || new.project_id
    from public.profiles p where p.role = 'admin';
  end if;
  return new;
end $$;
revoke all on function private.notify_service_request() from public, anon, authenticated;
drop trigger if exists notify_service_request on public.service_requests;
create trigger notify_service_request after insert on public.service_requests for each row execute function private.notify_service_request();
