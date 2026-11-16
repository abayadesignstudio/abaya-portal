-- (The VAPID private key was added to Vault separately as vapid_private; it is not in the repository.)
-- Web push: each browser/phone that turns on notifications stores its subscription here.
create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_profile on public.push_subscriptions (profile_id);
alter table public.push_subscriptions enable row level security;
create policy "own push read" on public.push_subscriptions for select to authenticated using (profile_id = (select auth.uid()));
create policy "own push add" on public.push_subscriptions for insert to authenticated with check (profile_id = (select auth.uid()));
create policy "own push change" on public.push_subscriptions for update to authenticated using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));
create policy "own push remove" on public.push_subscriptions for delete to authenticated using (profile_id = (select auth.uid()));
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- The VAPID signing key lives in Vault; only the server (service role) can read it.
create or replace function public.vapid_private_key() returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'vapid_private' limit 1 $$;
revoke all on function public.vapid_private_key() from public, anon, authenticated;
grant execute on function public.vapid_private_key() to service_role;

-- Send a push when: a staff member gets a notification; a client-visible update is posted with notify = 'now'.
create or replace function private.push_on_notification() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.call_fn('push-send', jsonb_build_object('profile_ids', jsonb_build_array(new.profile_id), 'title', 'Abaya', 'body', new.text, 'url', coalesce(new.href, '')));
  return new;
end $$;
revoke all on function private.push_on_notification() from public, anon, authenticated;
drop trigger if exists push_on_notification on public.notifications;
create trigger push_on_notification after insert on public.notifications for each row execute function private.push_on_notification();

create or replace function private.push_on_update() returns trigger language plpgsql security definer set search_path = '' as $$
declare ids jsonb; p record;
begin
  if new.notify <> 'now' or not new.visible_to_client then return new; end if;
  select number, name, client_id into p from public.projects where id = new.project_id;
  if p.client_id is null then return new; end if;
  select coalesce(jsonb_agg(pr.id), '[]'::jsonb) into ids from public.profiles pr where pr.client_id = p.client_id;
  if jsonb_array_length(ids) = 0 then return new; end if;
  perform private.call_fn('push-send', jsonb_build_object('profile_ids', ids, 'title', p.name, 'body', coalesce(new.title, 'New project update'), 'url', '#/projects/' || new.project_id));
  return new;
end $$;
revoke all on function private.push_on_update() from public, anon, authenticated;
drop trigger if exists push_on_update on public.updates;
create trigger push_on_update after insert on public.updates for each row execute function private.push_on_update();
