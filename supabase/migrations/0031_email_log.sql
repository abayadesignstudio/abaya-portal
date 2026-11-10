-- Project emails: sent/received work emails that involve a project's client contacts are logged as short
-- project updates (kind 'email'), automatically visible in the client portal. Read via each person's Gmail (read-only).
alter table public.updates drop constraint if exists updates_kind_check;
alter table public.updates add constraint updates_kind_check check (kind in ('memo','photos','list','meeting','change','email'));

alter table public.google_connections add column if not exists gmail_enabled boolean not null default false;
alter table public.google_connections add column if not exists gmail_synced_at timestamptz;

create table public.email_log (
  message_id text primary key,
  thread_id text,
  project_id uuid references public.projects(id) on delete cascade,
  update_id uuid references public.updates(id) on delete set null,
  from_email text, to_emails text[] not null default '{}', subject text,
  sent_at timestamptz, found_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index email_log_project_idx on public.email_log (project_id);
create index email_log_update_idx on public.email_log (update_id);
create index email_log_found_by_idx on public.email_log (found_by);
alter table public.email_log enable row level security;
create policy "staff read" on public.email_log for select using (private.is_staff());

create table public.email_seen (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  gmail_id text not null,
  seen_at timestamptz not null default now(),
  primary key (profile_id, gmail_id)
);
alter table public.email_seen enable row level security;

select cron.schedule('abaya-email-sync', '*/15 * * * *', $$select private.call_function('email-sync')$$);
