-- 0060 One source for fees, locked once signed, changed only by a client-signed fee change.
--  * Saved fee calculations can belong to a project (scratch work; never counted).
--  * A project has at most one working agreement (any status but void).
--  * While the agreement is a draft, the project's phase fees follow it: a payment schedule with one payment per phase sets
--    each phase's fee; otherwise percentage phases (phases.fee_pct) re-price from the agreement total.
--  * An agreement can only be published when its project's phases add up to the agreement fee.
--  * Published (out for signature) or signed: phase fees (fixed fees and hourly not-to-exceed caps) and additional services
--    with a fee are locked. Published → unpublish to change. Signed → only a fee change the client signs in the portal.

alter table public.fee_estimates add column if not exists project_id uuid references public.projects(id) on delete set null;
create index if not exists fee_estimates_project_idx on public.fee_estimates (project_id);

create unique index if not exists agreements_one_working_per_project on public.agreements (project_id)
  where status <> 'void' and project_id is not null;

-- phase code from a payment row's phase name (names as the agreement editor writes them)
create or replace function private.phase_code_of(n text) returns text language sql immutable set search_path = '' as $$
  select case lower(trim(coalesce(n, '')))
    when 'conceptual / exploratory' then 'CE' when 'schematic design' then 'SD' when 'design development' then 'DD'
    when 'construction documents' then 'CD' when 'bidding & negotiation' then 'BN' when 'bidding and negotiation' then 'BN'
    when 'permitting' then 'PM' when 'construction administration' then 'CA' end $$;

create or replace function private.fee_locked(p uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.agreements where project_id = p and status in ('sent', 'signed')) $$;
create or replace function private.contract_signed(p uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.agreements where project_id = p and status = 'signed') $$;
create or replace function private.phase_fee_total(p uuid) returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(fee), 0) from public.phases where project_id = p and code <> 'AS' $$;

-- agreement (draft or published) → project phase fees
create or replace function private.sync_phases_from_agreement() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record; n int; mapped int; t numeric := coalesce(new.total_fee, 0);
begin
  if new.project_id is null or new.status <> 'draft' or private.fee_locked(new.project_id) then return new; end if;
  select count(*), count(private.phase_code_of(x->>'phase')) into n, mapped from jsonb_array_elements(coalesce(new.doc->'pay', '[]'::jsonb)) x;
  if n = 0 or mapped < n then
    -- payments combine phases: percentage phases follow the total; fixed-amount phases stay as set
    update public.phases set fee = round(t * fee_pct / 100, 2)
      where project_id = new.project_id and fee_pct is not null and fee is distinct from round(t * fee_pct / 100, 2);
    return new;
  end if;
  for r in select private.phase_code_of(x->>'phase') as c,
                  sum(coalesce(nullif(regexp_replace(coalesce(x->>'pct', ''), '[^0-9.]', '', 'g'), '')::numeric, 0)) as pct
           from jsonb_array_elements(new.doc->'pay') x group by 1 loop
    update public.phases set fee = round(t * r.pct / 100, 2), fee_pct = null
      where project_id = new.project_id and code::text = r.c and (fee is distinct from round(t * r.pct / 100, 2) or fee_pct is not null);
    if not exists (select 1 from public.phases where project_id = new.project_id and code::text = r.c) then
      insert into public.phases (project_id, code, fee) values (new.project_id, r.c::public.phase_code, round(t * r.pct / 100, 2));
    end if;
  end loop;
  -- standard phases the agreement no longer includes keep their dates and time but carry no fee
  update public.phases set fee = 0, fee_pct = null
    where project_id = new.project_id and code::text in ('CE','SD','DD','CD','BN','PM','CA') and fee <> 0
      and code::text not in (select private.phase_code_of(x->>'phase') from jsonb_array_elements(new.doc->'pay') x);
  return new;
end $$;
drop trigger if exists agreements_sync_phases on public.agreements;
create trigger agreements_sync_phases after insert or update of doc, total_fee, status, project_id on public.agreements
  for each row execute function private.sync_phases_from_agreement();

-- signed → fees locked (except while a signed fee change is being applied)
create or replace function private.guard_locked_fees() returns trigger
language plpgsql set search_path = '' as $$
declare pid uuid := coalesce(new.project_id, old.project_id);
begin
  if coalesce(current_setting('abaya.fee_apply', true), '') = 'on' or not private.fee_locked(pid) then return coalesce(new, old); end if;
  if tg_op = 'INSERT' and coalesce(new.fee, 0) = 0 then return new; end if;
  if tg_op = 'DELETE' and coalesce(old.fee, 0) = 0 then return old; end if;
  if tg_op = 'UPDATE' and new.fee is not distinct from old.fee and new.fee_pct is not distinct from old.fee_pct
     and new.billing is not distinct from old.billing and new.project_id = old.project_id then return new; end if;
  if private.contract_signed(pid) then
    raise exception 'This project''s fees are locked by its signed agreement. Use “Change fee” on the project to send the client a fee change to sign.';
  end if;
  raise exception 'The agreement is out for the client''s signature, so its fees are locked. Unpublish it to change them.';
end $$;
drop trigger if exists phases_fee_lock on public.phases;
create trigger phases_fee_lock before insert or update or delete on public.phases
  for each row execute function private.guard_locked_fees();

-- ── Fee changes (amendments) ────────────────────────────────────────────────────────────────
create table if not exists public.fee_changes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  number int not null,
  title text not null default 'Fee change',
  reason text not null default '',
  -- [{ "phase_id": uuid|null, "code": "SD"|"AS"|…, "name": text|null, "parent_phase_id": uuid|null,
  --    "billing": "fixed"|"hourly", "from": number, "to": number }]
  lines jsonb not null default '[]'::jsonb,
  total_from numeric not null default 0,
  total_to numeric not null default 0,
  status text not null default 'draft' check (status in ('draft', 'sent', 'signed', 'void')),
  doc_hash text, sent_at timestamptz, signed_at timestamptz,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (project_id, number)
);
create index if not exists fee_changes_created_by_idx on public.fee_changes (created_by);
alter table public.fee_changes enable row level security;
create policy "staff all fee changes" on public.fee_changes for all to authenticated using (private.is_staff()) with check (private.is_staff());
create policy "client reads sent fee changes" on public.fee_changes for select to authenticated
  using (status in ('sent', 'signed') and private.client_can_see_project(project_id));

create table if not exists public.fee_change_signatures (
  fee_change_id uuid primary key references public.fee_changes(id) on delete cascade,
  signer_id uuid references public.profiles(id),
  signer_email text not null, signer_name text not null, signer_title text,
  method text not null check (method in ('style', 'draw', 'upload')),
  signature text not null,
  signed_at timestamptz not null default now(),
  ip text, user_agent text, doc_hash text not null
);
create index if not exists fee_change_signatures_signer_idx on public.fee_change_signatures (signer_id);
alter table public.fee_change_signatures enable row level security;
create policy "staff read fee change signatures" on public.fee_change_signatures for select to authenticated using (private.is_staff());
create policy "client reads own fee change signature" on public.fee_change_signatures for select to authenticated
  using (exists (select 1 from public.fee_changes f where f.id = fee_change_id and private.client_can_see_project(f.project_id)));

-- a published or signed fee change can't be edited; a signed one can't be voided (it has been applied)
create or replace function private.lock_fee_change() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status in ('sent', 'signed') and (new.lines is distinct from old.lines or new.reason is distinct from old.reason
     or new.title is distinct from old.title or new.total_from is distinct from old.total_from or new.total_to is distinct from old.total_to) then
    raise exception 'This fee change is with the client. Withdraw it to edit.';
  end if;
  if old.status = 'signed' and new.status <> 'signed' then raise exception 'A signed fee change has been applied and can''t be undone. Make a new fee change instead.'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists fee_changes_lock on public.fee_changes;
create trigger fee_changes_lock before update on public.fee_changes for each row execute function private.lock_fee_change();

create or replace function private.fee_change_hash(f public.fee_changes) returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(jsonb_build_object('title', f.title, 'reason', f.reason, 'lines', f.lines,
    'from', f.total_from, 'to', f.total_to)::text, 'UTF8')), 'hex') $$;

create or replace function public.publish_fee_change(p_id uuid, p_notify boolean default true) returns text
language plpgsql security definer set search_path = '' as $$
declare f public.fee_changes; l jsonb; cur numeric; h text;
begin
  if not private.is_staff() then raise exception 'Staff only'; end if;
  select * into f from public.fee_changes where id = p_id for update;
  if f.id is null then raise exception 'Fee change not found'; end if;
  if f.status <> 'draft' then raise exception 'Only a draft can be sent'; end if;
  if not private.contract_signed(f.project_id) then raise exception 'The agreement isn''t signed yet — change the fee on the agreement itself.'; end if;
  if jsonb_array_length(f.lines) = 0 then raise exception 'Add at least one change'; end if;
  if trim(f.reason) = '' then raise exception 'Say why the fee is changing'; end if;
  for l in select * from jsonb_array_elements(f.lines) loop
    if nullif(l->>'phase_id', '') is not null then
      select fee into cur from public.phases where id = (l->>'phase_id')::uuid and project_id = f.project_id;
      if cur is null then raise exception 'A phase in this fee change no longer exists'; end if;
      if round(cur, 2) <> round((l->>'from')::numeric, 2) then raise exception 'Phase fees changed since this was drafted. Reopen it to refresh.'; end if;
    end if;
  end loop;
  -- totals are worked out here, from the project as it stands, not trusted from the browser
  f.total_from := (select coalesce(sum(fee), 0) from public.phases where project_id = f.project_id);
  f.total_to := f.total_from + (select coalesce(sum((x->>'to')::numeric - coalesce((x->>'from')::numeric, 0)), 0) from jsonb_array_elements(f.lines) x);
  h := private.fee_change_hash(f);
  update public.fee_changes set status = 'sent', sent_at = now(), doc_hash = h, total_from = f.total_from, total_to = f.total_to where id = p_id;
  if p_notify then
    insert into public.updates (project_id, author, kind, title, body, visible_to_client, notify)
    values (f.project_id, auth.uid(), 'change', 'Fee change for your approval',
      'Please review ' || f.title || ' in your portal and sign it there. Nothing changes until you sign.', true, 'now');
  end if;
  return h;
end $$;

create or replace function public.unpublish_fee_change(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_staff() then raise exception 'Staff only'; end if;
  update public.fee_changes set status = 'draft', sent_at = null, doc_hash = null where id = p_id and status = 'sent';
  if not found then raise exception 'Only a fee change waiting for the client can be withdrawn'; end if;
end $$;

create or replace function public.sign_fee_change(p_id uuid, p_hash text, p_name text, p_title text, p_method text, p_signature text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare f public.fee_changes; me public.profiles; l jsonb; cur numeric; hdr json; t timestamptz := now();
begin
  select * into me from public.profiles where id = auth.uid();
  select * into f from public.fee_changes where id = p_id for update;
  if f.id is null or me.id is null or me.client_id is null
     or not exists (select 1 from public.projects where id = f.project_id and client_id = me.client_id) then raise exception 'Not your fee change'; end if;
  if f.status <> 'sent' then raise exception 'This fee change is not open for signing'; end if;
  if p_hash is distinct from f.doc_hash or private.fee_change_hash(f) <> f.doc_hash then raise exception 'The fee change was updated since you opened it. Reload the page.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Type your full name'; end if;
  if p_signature !~ '^data:image/png;base64,' or length(p_signature) > 300000 then raise exception 'Signature missing'; end if;
  -- the fees it starts from must still be the fees on the project
  for l in select * from jsonb_array_elements(f.lines) loop
    if nullif(l->>'phase_id', '') is not null then
      select fee into cur from public.phases where id = (l->>'phase_id')::uuid and project_id = f.project_id;
      if cur is null or round(cur, 2) <> round((l->>'from')::numeric, 2) then raise exception 'The project''s fees changed since this was sent. Please ask the firm to resend it.'; end if;
    end if;
  end loop;
  hdr := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  insert into public.fee_change_signatures (fee_change_id, signer_id, signer_email, signer_name, signer_title, method, signature, signed_at, ip, user_agent, doc_hash)
  values (p_id, me.id, me.email, trim(p_name), nullif(trim(coalesce(p_title, '')), ''), p_method, p_signature, t,
    split_part(coalesce(hdr->>'x-forwarded-for', hdr->>'x-real-ip', ''), ',', 1), left(hdr->>'user-agent', 400), f.doc_hash);
  update public.fee_changes set status = 'signed', signed_at = t where id = p_id;
  -- apply it
  perform set_config('abaya.fee_apply', 'on', true);
  for l in select * from jsonb_array_elements(f.lines) loop
    if nullif(l->>'phase_id', '') is not null then
      update public.phases set fee = (l->>'to')::numeric, fee_pct = null, billing = coalesce(nullif(l->>'billing', ''), billing)
        where id = (l->>'phase_id')::uuid;
    else
      insert into public.phases (project_id, code, name, fee, billing, parent_phase_id)
      values (f.project_id, (l->>'code')::public.phase_code, nullif(l->>'name', ''), (l->>'to')::numeric,
        coalesce(nullif(l->>'billing', ''), 'fixed'), nullif(l->>'parent_phase_id', '')::uuid);
    end if;
  end loop;
  perform set_config('abaya.fee_apply', 'off', true);
  insert into public.updates (project_id, author, kind, title, body, visible_to_client, notify)
  values (f.project_id, null, 'change', 'Fee change signed', trim(p_name) || ' signed ' || f.title || ' in the portal.', true, 'none');
  return t;
end $$;

revoke all on function public.publish_fee_change(uuid, boolean), public.unpublish_fee_change(uuid),
  public.sign_fee_change(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.publish_fee_change(uuid, boolean), public.unpublish_fee_change(uuid),
  public.sign_fee_change(uuid, text, text, text, text, text) to authenticated;

-- Publishing an agreement needs the project's phases to add up to its fee (so what the client signs matches Overview,
-- Budget and the portal). Same function as 0052 plus that check.
create or replace function public.publish_agreement(p_id uuid, p_sections integer[], p_logo text, p_notify boolean default true)
returns text language plpgsql security definer set search_path to 'public' as $function$
declare a public.agreements; h text; pt numeric;
begin
  if not private.is_staff() then raise exception 'Staff only'; end if;
  select * into a from agreements where id = p_id for update;
  if a.id is null then raise exception 'Agreement not found'; end if;
  if a.status <> 'draft' then raise exception 'Only a draft can be published'; end if;
  if a.client_id is null then raise exception 'Link the agreement to a project and client first'; end if;
  if a.project_id is not null then
    pt := private.phase_fee_total(a.project_id);
    if abs(pt - coalesce(a.total_fee, 0)) >= 0.05 then -- a few cents of rounding across phases is fine
      raise exception 'The project''s phases add up to $% but the agreement fee is $%. Split the fee into phases on the project (or set one payment per phase) before publishing.',
        to_char(pt, 'FM999,999,990.00'), to_char(coalesce(a.total_fee, 0), 'FM999,999,990.00');
    end if;
  end if;
  h := encode(sha256(convert_to(a.doc::text, 'UTF8')), 'hex');
  update agreements set status = 'sent', sent_at = now(), doc_hash = h, initial_sections = coalesce(p_sections, '{}'),
    published_logo = nullif(p_logo, '') where id = p_id;
  if a.project_id is not null and p_notify then
    insert into updates (project_id, author, kind, title, body, visible_to_client, notify)
    values (a.project_id, auth.uid(), 'memo', 'Your agreement is ready to sign',
      'Please review the agreement in your portal, initial each section and sign it there.', true, 'now');
  end if;
  return h;
end $function$;
revoke all on function public.publish_agreement(uuid, integer[], text, boolean) from public, anon;
grant execute on function public.publish_agreement(uuid, integer[], text, boolean) to authenticated;
