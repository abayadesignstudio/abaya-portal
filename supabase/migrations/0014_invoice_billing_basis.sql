-- What an invoice bills for: 'progress' = work done (phase % complete), 'advance' = a down payment billed ahead of the work.
-- Advance lines still post to their phases (invoice_lines.kind = 'phase'), so later invoices only bill what's left.
alter table public.invoices
  add column if not exists billing_basis text not null default 'progress'
  check (billing_basis in ('progress', 'advance'));
