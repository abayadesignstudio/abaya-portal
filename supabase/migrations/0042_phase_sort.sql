-- Manual phase order on a project (drag handle on the project page). Null = the standard order by phase code.
alter table public.phases add column if not exists sort int;
