-- Wire transfer instructions: entered once in Settings (admins), shown on the client's invoice page when the invoice allows wire.
-- Never put these in the repo or in emails; they live only in this row.
alter table public.firm_settings
  add column if not exists wire_bank_name text,
  add column if not exists wire_bank_address text,
  add column if not exists wire_account_name text,
  add column if not exists wire_routing text,
  add column if not exists wire_account text,
  add column if not exists wire_swift text,
  add column if not exists wire_notes text;
alter table public.invoices add column if not exists allow_wire boolean not null default true;
