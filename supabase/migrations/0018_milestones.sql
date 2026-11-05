-- Project milestones with their own dates (not tied to phase ends), shown as pins on the Projects timeline.
create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  phase_id uuid references public.phases(id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  date date not null,
  done boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists milestones_project_idx on public.milestones (project_id, date);
alter table public.milestones enable row level security;
drop policy if exists "staff all" on public.milestones;
create policy "staff all" on public.milestones for all to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
