-- A project can be more than one type (e.g. residential work is often Shell + Finish-Out).
-- `categories` holds every type; `category` stays as the first one so older code and filters keep working.
alter table public.projects add column if not exists categories public.project_category[] not null default '{}';
update public.projects set categories = array[category] where category is not null and cardinality(categories) = 0;

create or replace function private.sync_project_categories()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if cardinality(new.categories) = 0 and new.category is not null then new.categories := array[new.category]; end if;
  elsif new.categories is not distinct from old.categories and new.category is distinct from old.category then
    -- an older screen changed only `category`
    new.categories := case when new.category is null then '{}' else array[new.category] end;
  end if;
  -- keep categories in S, FO, CON order without duplicates, and category = the first
  new.categories := array(select distinct c from unnest(new.categories) c order by c);
  new.category := new.categories[1];
  return new;
end $$;

drop trigger if exists projects_categories on public.projects;
create trigger projects_categories before insert or update on public.projects
  for each row execute function private.sync_project_categories();
