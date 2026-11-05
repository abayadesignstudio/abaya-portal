-- Every agreement belongs to a project (start a new project with status "proposal" for a prospective job).
-- A project that still has agreements can't be deleted (move or void them first).
alter table public.agreements drop constraint if exists agreements_project_id_fkey;
alter table public.agreements alter column project_id set not null;
alter table public.agreements add constraint agreements_project_id_fkey foreign key (project_id) references public.projects(id) on delete restrict;
create index if not exists agreements_project_idx on public.agreements (project_id);
