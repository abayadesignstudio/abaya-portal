-- The chosen sort (Custom, Newest, …) is saved per person with their order, so it survives new days, devices and browsers.
alter table public.project_order add column if not exists sort text;
-- Every change to a person's order keeps the previous version, so an accidental reorder can be undone.
create table if not exists public.project_order_history (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  project_ids uuid[] not null,
  saved_at timestamptz not null default now()
);
alter table public.project_order_history enable row level security;
create policy "own order history read" on public.project_order_history for select to authenticated using (profile_id = (select auth.uid()) and (select private.is_staff()));
grant select on public.project_order_history to authenticated;
create or replace function private.keep_project_order() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.project_ids is distinct from new.project_ids and cardinality(old.project_ids) > 0 then
    insert into public.project_order_history (profile_id, project_ids, saved_at) values (old.profile_id, old.project_ids, old.updated_at);
    delete from public.project_order_history h where h.profile_id = old.profile_id
      and h.id not in (select id from public.project_order_history where profile_id = old.profile_id order by id desc limit 30);
  end if;
  return new;
end $$;
drop trigger if exists keep_project_order on public.project_order;
create trigger keep_project_order before update on public.project_order for each row execute function private.keep_project_order();
update public.project_order set sort = 'custom' where sort is null;
