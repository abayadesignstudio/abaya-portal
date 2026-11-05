-- Firm rate table: each role has one or more billable rate levels (Principal 1 — $300). A project member's role and
-- rate are picked from here, so the two stay tied. Admins manage it in Settings; staff can read it.
create table public.billing_rates (
  id uuid primary key default gen_random_uuid(),
  role text not null check (length(btrim(role)) between 1 and 60),
  level text not null check (length(btrim(level)) between 1 and 60),
  rate numeric(10,2) not null check (rate >= 0),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (role, level)
);
alter table public.billing_rates enable row level security;
create policy "staff read rates" on public.billing_rates for select to authenticated using ((select private.is_staff()));
create policy "admins manage rates" on public.billing_rates for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
grant select, insert, update, delete on public.billing_rates to authenticated;
-- which rate level a project member uses (role_label and bill_rate stay as the values used everywhere)
alter table public.project_members add column if not exists rate_id uuid references public.billing_rates(id) on delete set null;
create index if not exists project_members_rate_idx on public.project_members (rate_id);
insert into public.billing_rates (role, level, rate, sort) values
  ('Principal', 'Principal 1', 300, 10), ('Project Architect', 'Project Architect 1', 250, 20),
  ('Designer', 'Designer 1', 150, 30), ('Drafter', 'Drafter 1', 100, 40), ('Intern', 'Intern 1', 75, 50);
