-- Additional services become their own phase lines (code AS)
alter type public.phase_code add value if not exists 'AS';
