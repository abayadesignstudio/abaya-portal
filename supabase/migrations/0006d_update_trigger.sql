-- Email an update to the client right away when it is posted with notify = 'now'.
create or replace function private.call_fn(fn text, body jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare s text;
begin
  select decrypted_secret into s from vault.decrypted_secrets where name = 'cron_secret';
  perform net.http_post(
    url := 'https://ozowlkstprkvktosetci.supabase.co/functions/v1/' || fn,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', s),
    body := body);
end $$;
revoke all on function private.call_fn(text, jsonb) from public, anon, authenticated;

create or replace function private.updates_send_now()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.notify = 'now' and new.visible_to_client and new.emailed_at is null then
    perform private.call_fn('send-update', jsonb_build_object('update_id', new.id));
  end if;
  return new;
end $$;
revoke all on function private.updates_send_now() from public, anon, authenticated;

drop trigger if exists updates_send_now on public.updates;
create trigger updates_send_now after insert on public.updates
  for each row execute function private.updates_send_now();
