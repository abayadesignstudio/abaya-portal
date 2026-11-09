-- A time entry (and a running timer / timesheet row) can carry its own hourly rate for a custom role,
-- e.g. a project still billed at an older agreement's rate. Null = use the person's project or standard rate.
alter table public.time_entries add column if not exists bill_rate numeric(10,2) check (bill_rate is null or bill_rate >= 0);
alter table public.timers add column if not exists bill_rate numeric(10,2) check (bill_rate is null or bill_rate >= 0);
alter table public.timesheet_rows add column if not exists bill_rate numeric(10,2) check (bill_rate is null or bill_rate >= 0);
