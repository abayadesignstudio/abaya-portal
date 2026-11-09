-- Firm-wide options for "What we need" (Bills page and Home): employer payroll taxes on salaries and a profit margin.
-- Everyone on staff reads them; only admins can change them.
alter table public.firm_settings
  add column if not exists need_payroll_tax boolean not null default false,
  add column if not exists need_margin numeric(5,2) not null default 0 check (need_margin >= 0 and need_margin < 90);

-- start from what Joshua set on the Bills page (before the guard exists)
update public.firm_settings set need_payroll_tax = true, need_margin = 10 where id = 1;

create or replace function private.guard_need_targets()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.need_payroll_tax is distinct from old.need_payroll_tax or new.need_margin is distinct from old.need_margin)
     and not (select private.is_admin()) then
    raise exception 'Only an admin can change the payroll-tax and profit-margin settings.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists firm_settings_need_guard on public.firm_settings;
create trigger firm_settings_need_guard before update on public.firm_settings
  for each row execute function private.guard_need_targets();

