-- Invoice builder: email content and delivery options
alter table public.invoices
  add column if not exists email_subject text,
  add column if not exists email_message text,
  add column if not exists agreement_mode text not null default 'link' check (agreement_mode in ('link','attach','none')),
  add column if not exists show_prior_balance boolean not null default true;
