-- Saved fee triangulations (Proposals/Agreements → Fee triangulator). Staff only.
create table if not exists public.fee_estimates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  inputs jsonb not null,            -- { rows:[{profile_id,hours,rate}], sf, perSf, costPerSf, pct }
  hourly_fee numeric(12,2),
  sf_fee numeric(12,2),
  pct_fee numeric(12,2),
  median_fee numeric(12,2),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fee_estimates_created on public.fee_estimates (created_at desc);
alter table public.fee_estimates enable row level security;
create policy "staff all" on public.fee_estimates for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
