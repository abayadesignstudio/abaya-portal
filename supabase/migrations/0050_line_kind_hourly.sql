-- Hourly invoice lines (billed hours on hourly phases) need their own line kind.
alter type public.line_kind add value if not exists 'hourly' after 'phase';
