-- Consultant fees carried on a project's budget
create table public.project_consultants (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  phase_id uuid references public.phases(id) on delete set null,
  name text not null,
  discipline text,
  fee numeric(12,2) not null default 0,
  billed numeric(12,2) not null default 0,
  markup_pct numeric(5,2) not null default 0,
  created_at timestamptz not null default now()
);
create index on public.project_consultants (project_id);
alter table public.project_consultants enable row level security;
create policy "staff all" on public.project_consultants for all to authenticated using (private.is_staff()) with check (private.is_staff());

-- Direct expense budget lines use public.expenses; add an optional phase and a planned flag
alter table public.expenses add column if not exists phase_id uuid references public.phases(id) on delete set null;
alter table public.expenses add column if not exists planned boolean not null default false;
