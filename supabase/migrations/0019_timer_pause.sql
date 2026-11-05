-- Pause / resume for the sidebar timer: while paused, paused_at is set and the clock stands still.
-- banked_seconds holds time from earlier running stretches (to the second; banked_minutes stays for old rows).
alter table public.timers add column if not exists paused_at timestamptz;
alter table public.timers add column if not exists banked_seconds int not null default 0;
