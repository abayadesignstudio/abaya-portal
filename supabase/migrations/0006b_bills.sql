-- Company bills and monthly budgets (staff read, admin write)
create table public.company_bills (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  amount numeric(12,2) not null,
  due_on date not null,
  paid_on date,
  recurring_monthly boolean not null default false,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index on public.company_bills (due_on);
create table public.bill_budgets (
  month date not null check (extract(day from month) = 1),
  category text not null,
  amount numeric(12,2) not null default 0,
  primary key (month, category)
);
alter table public.company_bills enable row level security;
alter table public.bill_budgets enable row level security;
create policy "staff read bills" on public.company_bills for select to authenticated using (private.is_staff());
create policy "admin write bills" on public.company_bills for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "staff read budgets" on public.bill_budgets for select to authenticated using (private.is_staff());
create policy "admin write budgets" on public.bill_budgets for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- Receipts for expenses
alter table public.expenses add column if not exists receipt_path text;
insert into storage.buckets (id, name, public) values ('receipts','receipts', false) on conflict (id) do nothing;
create policy "staff manage receipts" on storage.objects for all to authenticated
  using (bucket_id = 'receipts' and private.is_staff()) with check (bucket_id = 'receipts' and private.is_staff());

-- Firm profile shown on invoices and agreements
alter table public.firm_settings add column if not exists firm_name text not null default 'Abaya Design Studio, LLC',
  add column if not exists address text not null default '215 S Denton Tap Road, Suite 215, Coppell, Texas 75019',
  add column if not exists phone text,
  add column if not exists billing_email text not null default 'billing@abayadesignstudio.com',
  add column if not exists check_payee text not null default 'Abaya Design Studio, LLC';
