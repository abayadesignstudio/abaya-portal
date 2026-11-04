-- 0008: tasks on the home calendars, and each person's Google connection for syncing tasks to Google Tasks.

-- Tasks: assigned to one staff member; admins can assign to anyone, staff to themselves.
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 200),
  notes text,
  assignee uuid not null references public.profiles(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  due_on date not null,
  due_time time,
  project_id uuid references public.projects(id) on delete set null,
  done_at timestamptz,
  google_task_id text,          -- id of the matching Google Task (set by the task-sync function)
  google_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_assignee_due_idx on public.tasks (assignee, due_on);
create index if not exists tasks_due_idx on public.tasks (due_on);
create index if not exists tasks_project_idx on public.tasks (project_id);
create index if not exists tasks_created_by_idx on public.tasks (created_by);

create or replace function private.tasks_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  -- staff may only create/move tasks for themselves; admins for anyone
  if not private.is_admin() and new.assignee is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.assignee is distinct from old.assignee) then
    raise exception 'Only an admin can assign tasks to someone else';
  end if;
  return new;
end $$;
revoke all on function private.tasks_guard() from public, anon, authenticated;
drop trigger if exists tasks_guard on public.tasks;
create trigger tasks_guard before insert or update on public.tasks for each row execute function private.tasks_guard();

alter table public.tasks enable row level security;
-- every staff member sees everyone's tasks (shared team schedule); clients see none
drop policy if exists "staff read" on public.tasks;
create policy "staff read" on public.tasks for select to authenticated using ((select private.is_staff()));
drop policy if exists "staff insert" on public.tasks;
create policy "staff insert" on public.tasks for insert to authenticated with check ((select private.is_staff()));
-- edit/complete/delete: the assignee, whoever created it, or an admin
drop policy if exists "owner or admin update" on public.tasks;
create policy "owner or admin update" on public.tasks for update to authenticated
  using ((select private.is_staff()) and (assignee = (select auth.uid()) or created_by = (select auth.uid()) or (select private.is_admin())))
  with check ((select private.is_staff()));
drop policy if exists "owner or admin delete" on public.tasks;
create policy "owner or admin delete" on public.tasks for delete to authenticated
  using ((select private.is_staff()) and (assignee = (select auth.uid()) or created_by = (select auth.uid()) or (select private.is_admin())));
grant select, insert, update, delete on public.tasks to authenticated;
revoke all on public.tasks from anon;

-- Google connection per person. Holds the OAuth refresh token, so NO client access at all:
-- RLS on with no policies, and no grants to anon/authenticated. Only edge functions (service role) read it.
create table if not exists public.google_connections (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  google_email text,
  refresh_token text not null,
  tasklist_id text,             -- the person's Google Tasks list used for portal tasks
  connected_at timestamptz not null default now()
);
alter table public.google_connections enable row level security;
revoke all on public.google_connections from anon, authenticated;

-- What the portal may know about my own connection: whether it exists and which Google account.
create or replace function public.my_google_connection() returns table (google_email text, connected_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select google_email, connected_at from public.google_connections where profile_id = auth.uid()
$$;
revoke all on function public.my_google_connection() from public, anon;
grant execute on function public.my_google_connection() to authenticated;

-- Disconnect my own Google account.
create or replace function public.disconnect_google() returns void
language sql security definer set search_path = '' as $$
  delete from public.google_connections where profile_id = auth.uid()
$$;
revoke all on function public.disconnect_google() from public, anon;
grant execute on function public.disconnect_google() to authenticated;
