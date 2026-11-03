-- Email delivery, tracking, reminders and the daily client digest
alter table public.invoices add column if not exists reminders_sent int not null default 0;
alter table public.invoices add column if not exists last_reminder_at timestamptz;
alter table public.updates add column if not exists emailed_at timestamptz;
alter table public.firm_settings add column if not exists public_base_url text not null default 'https://jabaya7175-ai.github.io/abaya-portal';
alter table public.firm_settings add column if not exists last_digest_on date;
alter table public.firm_settings add column if not exists last_reminders_on date;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- A random shared secret, kept in Vault, that the scheduled jobs send and the functions check
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cron_secret', 'Header secret for scheduled email functions');
  end if;
end $$;

create or replace function private.cron_secret_ok(s text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'cron_secret' and decrypted_secret = s)
$$;
revoke all on function private.cron_secret_ok(text) from public, anon, authenticated;
grant execute on function private.cron_secret_ok(text) to service_role;
grant usage on schema private to service_role;

-- callable over the API only by the service role (functions use it)
create or replace function public.check_cron_secret(s text) returns boolean
language sql stable security definer set search_path = '' as $$ select private.cron_secret_ok(s) $$;
revoke all on function public.check_cron_secret(text) from public, anon, authenticated;
grant execute on function public.check_cron_secret(text) to service_role;

create or replace function private.call_function(fn text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://ozowlkstprkvktosetci.supabase.co/functions/v1/' || fn,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
end $$;
revoke all on function private.call_function(text) from public, anon, authenticated;

-- hourly; the functions decide whether it is time (digest at 6 PM Central, reminders once each morning)
select cron.unschedule(jobid) from cron.job where jobname in ('abaya-reminders', 'abaya-digest');
select cron.schedule('abaya-reminders', '5 * * * *', $$select private.call_function('reminders')$$);
select cron.schedule('abaya-digest', '1 * * * *', $$select private.call_function('daily-digest')$$);
