-- A project that is one person's own work (not the firm's): it stays in the portal for them, but its hours and money
-- are left out of firm totals (utilization, time this week, what we need, collected, invoice totals).
alter table public.projects add column if not exists outside_firm boolean not null default false;
comment on column public.projects.outside_firm is 'Personal/outside work: excluded from firm time and money totals.';
update public.projects set outside_firm = true where number = 'VDRC';
