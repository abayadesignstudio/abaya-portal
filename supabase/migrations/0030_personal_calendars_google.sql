-- A personal Google calendar shared with the person's work Google account: stored by its address (calendar id),
-- read through their existing Google connection (Google blocks iCal links fetched from cloud servers).
alter table public.personal_calendars drop constraint if exists personal_calendars_ics_url_check;
alter table public.personal_calendars add constraint personal_calendars_source_check
  check (ics_url ~* '^(https?|webcal)://' or ics_url ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
