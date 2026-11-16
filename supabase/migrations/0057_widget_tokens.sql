-- Per-device tokens for the iPhone home-screen widget (stored hashed; only the widget function reads them).
create table if not exists public.widget_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  label text not null default 'iPhone',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.widget_tokens enable row level security; -- no policies: service role only
create policy "see own widget links" on public.widget_tokens for select to authenticated using (profile_id = auth.uid());
create policy "remove own widget links" on public.widget_tokens for delete to authenticated using (profile_id = auth.uid());
