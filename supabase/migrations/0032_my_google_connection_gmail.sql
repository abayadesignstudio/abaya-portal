drop function if exists public.my_google_connection();
create function public.my_google_connection()
 returns table(google_email text, connected_at timestamptz, gmail_enabled boolean, gmail_synced_at timestamptz)
 language sql stable security definer set search_path = ''
as $$ select google_email, connected_at, gmail_enabled, gmail_synced_at from public.google_connections where profile_id = auth.uid() $$;
revoke all on function public.my_google_connection() from public, anon;
grant execute on function public.my_google_connection() to authenticated;
