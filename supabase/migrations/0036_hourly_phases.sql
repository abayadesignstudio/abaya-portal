-- Custom phases (code CU, named per project, any number of them) and hourly billing for any phase.
alter table public.phases add column if not exists billing text not null default 'fixed' check (billing in ('fixed', 'hourly'));
drop index if exists public.phases_project_code_main;
create unique index phases_project_code_main on public.phases (project_id, code) where service_id is null and name is null;
alter table public.time_entries add column if not exists invoice_id uuid references public.invoices(id) on delete set null;
create index if not exists time_entries_invoice_idx on public.time_entries (invoice_id);
create or replace function private.release_hours_on_void() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'void' and old.status is distinct from 'void' then
    update public.time_entries set invoice_id = null where invoice_id = new.id;
  end if;
  return new;
end $$;
revoke all on function private.release_hours_on_void() from public, anon, authenticated;
drop trigger if exists release_hours_on_void on public.invoices;
create trigger release_hours_on_void after update of status on public.invoices
  for each row execute function private.release_hours_on_void();
