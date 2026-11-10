-- E-signature in the client portal. Staff publish an agreement (its text is frozen and fingerprinted);
-- the client initials every section and signs in the portal; who/when/IP/device and the fingerprint are kept as the audit record.
alter table public.agreements add column if not exists doc_hash text,
  add column if not exists initial_sections int[] not null default '{}',
  add column if not exists published_logo text;

create table if not exists public.agreement_signatures (
  agreement_id uuid primary key references public.agreements(id) on delete cascade,
  signer_id uuid references public.profiles(id),
  signer_email text not null,
  signer_name text not null,
  signer_title text,
  method text not null check (method in ('style','draw','upload')),
  signature text not null,      -- PNG data URL
  initials_img text not null,   -- PNG data URL
  initials jsonb not null,      -- { "<section>": "<timestamp>" }
  consent_at timestamptz not null,
  signed_at timestamptz not null default now(),
  ip text, user_agent text,
  doc_hash text not null
);
alter table public.agreement_signatures enable row level security;
create policy "staff read signatures" on public.agreement_signatures for select to authenticated using (private.is_staff());
create policy "client reads own signature" on public.agreement_signatures for select to authenticated
  using (exists (select 1 from public.agreements a where a.id = agreement_id and a.client_id = private.my_client_id()));

-- once published, the text can't change; a signed agreement can only be voided
create or replace function private.lock_agreement() returns trigger language plpgsql as $$
begin
  if old.status in ('sent','signed') and new.doc is distinct from old.doc then
    raise exception 'This agreement is published and locked. Unpublish it to edit.';
  end if;
  if old.status = 'signed' and new.status not in ('signed','void') then
    raise exception 'A signed agreement can only be voided.';
  end if;
  return new;
end $$;
drop trigger if exists agreements_lock on public.agreements;
create trigger agreements_lock before update on public.agreements for each row execute function private.lock_agreement();

create or replace function public.publish_agreement(p_id uuid, p_sections int[], p_logo text) returns text
language plpgsql security definer set search_path = public as $$
declare a public.agreements; h text;
begin
  if not private.is_staff() then raise exception 'Staff only'; end if;
  select * into a from agreements where id = p_id for update;
  if a.id is null then raise exception 'Agreement not found'; end if;
  if a.status <> 'draft' then raise exception 'Only a draft can be published'; end if;
  if a.client_id is null then raise exception 'Link the agreement to a project and client first'; end if;
  h := encode(sha256(convert_to(a.doc::text, 'UTF8')), 'hex');
  update agreements set status = 'sent', sent_at = now(), doc_hash = h, initial_sections = coalesce(p_sections, '{}'),
    published_logo = nullif(p_logo, '') where id = p_id;
  if a.project_id is not null then
    insert into updates (project_id, author, kind, title, body, visible_to_client, notify)
    values (a.project_id, auth.uid(), 'memo', 'Your agreement is ready to sign',
      'Please review the agreement in your portal, initial each section and sign it there.', true, 'now');
  end if;
  return h;
end $$;

create or replace function public.unpublish_agreement(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not private.is_staff() then raise exception 'Staff only'; end if;
  update agreements set status = 'draft', sent_at = null, doc_hash = null where id = p_id and status = 'sent';
  if not found then raise exception 'Only a published, unsigned agreement can be unpublished'; end if;
end $$;

create or replace function public.sign_agreement(p_id uuid, p_hash text, p_name text, p_title text, p_method text,
  p_signature text, p_initials_img text, p_initials jsonb) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare a public.agreements; me public.profiles; hdr json; s int; t timestamptz := now();
begin
  select * into me from profiles where id = auth.uid();
  select * into a from agreements where id = p_id for update;
  if a.id is null or me.id is null or me.client_id is null or a.client_id is distinct from me.client_id then raise exception 'Not your agreement'; end if;
  if a.status <> 'sent' then raise exception 'This agreement is not open for signing'; end if;
  -- the text the client read must be the text that was published, and unchanged since
  if p_hash is distinct from a.doc_hash or encode(sha256(convert_to(a.doc::text, 'UTF8')), 'hex') <> a.doc_hash then
    raise exception 'The agreement changed since you opened it. Reload the page.';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Type your full name'; end if;
  if p_signature !~ '^data:image/png;base64,' or p_initials_img !~ '^data:image/png;base64,' then raise exception 'Signature missing'; end if;
  if length(p_signature) > 300000 or length(p_initials_img) > 200000 then raise exception 'Signature image too large'; end if;
  foreach s in array a.initial_sections loop
    if not (p_initials ? s::text) then raise exception 'Initial every section (section % is missing)', s; end if;
  end loop;
  hdr := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  insert into agreement_signatures (agreement_id, signer_id, signer_email, signer_name, signer_title, method, signature, initials_img, initials,
    consent_at, signed_at, ip, user_agent, doc_hash)
  values (p_id, me.id, me.email, trim(p_name), nullif(trim(coalesce(p_title, '')), ''), p_method, p_signature, p_initials_img, p_initials,
    t, t, split_part(coalesce(hdr->>'x-forwarded-for', hdr->>'x-real-ip', ''), ',', 1), left(hdr->>'user-agent', 400), a.doc_hash);
  update agreements set status = 'signed', signed_at = t where id = p_id;
  if a.project_id is not null then
    insert into updates (project_id, author, kind, title, body, visible_to_client, notify)
    values (a.project_id, null, 'memo', 'Agreement signed', trim(p_name) || ' signed “' || a.title || '” in the portal.', true, 'none');
  end if;
  return t;
end $$;
revoke all on function public.publish_agreement(uuid, int[], text), public.unpublish_agreement(uuid),
  public.sign_agreement(uuid, text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.publish_agreement(uuid, int[], text), public.unpublish_agreement(uuid),
  public.sign_agreement(uuid, text, text, text, text, text, text, jsonb) to authenticated;
