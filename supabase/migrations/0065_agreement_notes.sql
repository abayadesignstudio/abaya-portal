-- Internal notes on an agreement: staff only. Clients have no policy on this table, so they can never read it
-- (agreement doc/rows are readable by the client once published, which is why notes live here, not in the doc).
create table if not exists public.agreement_notes (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.agreements(id) on delete cascade,
  body text not null check (length(btrim(body)) > 0),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists agreement_notes_agreement_idx on public.agreement_notes (agreement_id, created_at);
create index if not exists agreement_notes_created_by_idx on public.agreement_notes (created_by);
alter table public.agreement_notes enable row level security;
revoke all on public.agreement_notes from anon;
create policy "staff read agreement notes" on public.agreement_notes for select to authenticated using ((select private.is_staff()));
create policy "staff add agreement notes" on public.agreement_notes for insert to authenticated
  with check ((select private.is_staff()) and created_by = (select auth.uid()));
create policy "author or admin edits agreement notes" on public.agreement_notes for update to authenticated
  using ((select private.is_staff()) and (created_by = (select auth.uid()) or (select private.is_admin())));
create policy "author or admin deletes agreement notes" on public.agreement_notes for delete to authenticated
  using ((select private.is_staff()) and (created_by = (select auth.uid()) or (select private.is_admin())));
