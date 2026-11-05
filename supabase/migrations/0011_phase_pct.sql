-- A phase's fee can be a fixed amount (fee_pct null) or a percentage of the project's total fee (fee_pct set).
-- phases.fee always holds the dollar amount (kept in step with the total by the portal), so invoices keep working.
alter table public.phases add column if not exists fee_pct numeric(6,3) check (fee_pct is null or (fee_pct >= 0 and fee_pct <= 100));
