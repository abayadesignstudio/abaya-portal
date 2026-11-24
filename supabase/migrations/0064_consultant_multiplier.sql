-- Firm-wide default multiplier for consultants' additional services (their bill × multiplier = what the owner pays).
-- Staff read it (firm_settings policies); admins change it.
alter table public.firm_settings
  add column if not exists consultant_multiplier numeric not null default 1.15
  check (consultant_multiplier >= 1 and consultant_multiplier <= 5);
