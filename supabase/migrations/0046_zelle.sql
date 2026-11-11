-- Zelle: entered once in Settings (admins), shown on the client's invoice page when the invoice allows Zelle.
-- zelle_qr is the link encoded in the bank's Zelle QR code; the page redraws it as a QR.
alter table public.firm_settings
  add column if not exists zelle_name text,
  add column if not exists zelle_email text,
  add column if not exists zelle_phone text,
  add column if not exists zelle_qr text;
alter table public.firm_settings drop constraint if exists firm_settings_zelle_qr_https;
alter table public.firm_settings add constraint firm_settings_zelle_qr_https check (zelle_qr is null or zelle_qr ~ '^https://enroll\.zellepay\.com/');
alter table public.invoices add column if not exists allow_zelle boolean not null default true;
