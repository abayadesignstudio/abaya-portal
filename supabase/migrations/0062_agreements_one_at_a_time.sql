-- 0062 Agreements one at a time, each owning its phases.
--  * A project can have several agreements, but only one open (draft or published) at a time; a new one can start once the
--    previous is signed (e.g. CE now, SD–CA later).
--  * Each agreement's phases = its fee-by-phase split (phases with a %) or, without a split, the phases switched on in it.
--  * A phase is locked when it belongs to a published or signed agreement; extras (AS, custom phases) lock once any
--    agreement is published or signed. A draft agreement sets only its own, unlocked phases.
drop index if exists public.agreements_one_working_per_project;
create unique index if not exists agreements_one_open_per_project on public.agreements (project_id)
  where status in ('draft', 'sent') and project_id is not null;

create or replace function private.agreement_codes(d jsonb) returns text[] language sql immutable set search_path = '' as $$
  select coalesce(
    (select array_agg(e.key) from jsonb_each_text(case when jsonb_typeof(d->'split') = 'object' then d->'split' else '{}'::jsonb end) e
      where e.key in ('CE','SD','DD','CD','BN','PM','CA') and coalesce(d->'ph'->e.key->>'on', 'false') = 'true'
        and coalesce(nullif(regexp_replace(e.value, '[^0-9.]', '', 'g'), '')::numeric, 0) > 0),
    (select array_agg(k.key) from jsonb_each(case when jsonb_typeof(d->'ph') = 'object' then d->'ph' else '{}'::jsonb end) k
      where coalesce(k.value->>'on', 'false') = 'true'),
    '{}'::text[]) $$;

-- phases held by published/signed agreements (optionally ignoring one agreement)
create or replace function private.locked_codes(p uuid, except_id uuid default null, only_signed boolean default false) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct c), '{}'::text[]) from public.agreements a, unnest(private.agreement_codes(a.doc)) c
  where a.project_id = p and (a.status = 'signed' or (not only_signed and a.status = 'sent')) and a.id is distinct from except_id $$;

create or replace function private.guard_locked_fees() returns trigger
language plpgsql set search_path = '' as $$
declare pid uuid := coalesce(new.project_id, old.project_id); c text := coalesce(new.code, old.code)::text; held boolean;
begin
  if coalesce(current_setting('abaya.fee_apply', true), '') = 'on' or not private.fee_locked(pid) then return coalesce(new, old); end if;
  held := c = any(private.locked_codes(pid)) or c not in ('CE','SD','DD','CD','BN','PM','CA');
  if not held then return coalesce(new, old); end if;
  if tg_op = 'INSERT' and coalesce(new.fee, 0) = 0 then return new; end if;
  if tg_op = 'DELETE' and coalesce(old.fee, 0) = 0 then return old; end if;
  if tg_op = 'UPDATE' and new.fee is not distinct from old.fee and new.fee_pct is not distinct from old.fee_pct
     and new.billing is not distinct from old.billing and new.project_id = old.project_id then return new; end if;
  if c = any(private.locked_codes(pid, null, true)) or (c not in ('CE','SD','DD','CD','BN','PM','CA') and private.contract_signed(pid)) then
    raise exception 'This phase''s fee is locked by a signed agreement. Use “Change fee” on the project to send the client a fee change to sign.';
  end if;
  raise exception 'This phase is in an agreement that is out for the client''s signature, so its fee is locked. Unpublish it to change it.';
end $$;

create or replace function private.sync_phases_from_agreement() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record; n int; mapped int; t numeric := coalesce(new.total_fee, 0); ssum numeric := 0; held text[];
begin
  if new.project_id is null or new.status <> 'draft' then return new; end if;
  held := private.locked_codes(new.project_id, new.id);

  if jsonb_typeof(new.doc->'split') = 'object' then
    select coalesce(sum(coalesce(nullif(regexp_replace(e.value, '[^0-9.]', '', 'g'), '')::numeric, 0)), 0) into ssum
      from jsonb_each_text(new.doc->'split') e
      where e.key in ('CE','SD','DD','CD','BN','PM','CA') and coalesce(new.doc->'ph'->e.key->>'on', 'false') = 'true';
  end if;
  if ssum > 0 then
    for r in select e.key as c, coalesce(nullif(regexp_replace(e.value, '[^0-9.]', '', 'g'), '')::numeric, 0) as pct
             from jsonb_each_text(new.doc->'split') e
             where e.key in ('CE','SD','DD','CD','BN','PM','CA') and coalesce(new.doc->'ph'->e.key->>'on', 'false') = 'true' loop
      continue when r.pct = 0 or r.c = any(held);
      update public.phases set fee = round(t * r.pct / 100, 2), fee_pct = null
        where project_id = new.project_id and code::text = r.c and (fee is distinct from round(t * r.pct / 100, 2) or fee_pct is not null);
      if not exists (select 1 from public.phases where project_id = new.project_id and code::text = r.c) then
        insert into public.phases (project_id, code, fee) values (new.project_id, r.c::public.phase_code, round(t * r.pct / 100, 2));
      end if;
    end loop;
    update public.phases set fee = 0, fee_pct = null
      where project_id = new.project_id and code::text in ('CE','SD','DD','CD','BN','PM','CA') and fee <> 0
        and not (code::text = any(held))
        and code::text not in (select e.key from jsonb_each_text(new.doc->'split') e
          where coalesce(nullif(regexp_replace(e.value, '[^0-9.]', '', 'g'), '')::numeric, 0) > 0 and coalesce(new.doc->'ph'->e.key->>'on', 'false') = 'true');
    return new;
  end if;

  if private.fee_locked(new.project_id) then return new; end if; -- older schedules: only on a project with nothing published or signed
  select count(*), count(private.phase_code_of(x->>'phase')) into n, mapped from jsonb_array_elements(coalesce(new.doc->'pay', '[]'::jsonb)) x;
  if n = 0 or mapped < n then
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
  update public.phases set fee = 0, fee_pct = null
    where project_id = new.project_id and code::text in ('CE','SD','DD','CD','BN','PM','CA') and fee <> 0
      and code::text not in (select private.phase_code_of(x->>'phase') from jsonb_array_elements(new.doc->'pay') x);
  return new;
end $$;

-- publishing: this agreement's own phases must add up to its fee, and none may already be in a published or signed agreement
create or replace function public.publish_agreement(p_id uuid, p_sections integer[], p_logo text, p_notify boolean default true)
returns text language plpgsql security definer set search_path to 'public' as $function$
declare a public.agreements; h text; pt numeric; mine text[]; clash text[];
begin
  if not private.is_staff() then raise exception 'Staff only'; end if;
  select * into a from agreements where id = p_id for update;
  if a.id is null then raise exception 'Agreement not found'; end if;
  if a.status <> 'draft' then raise exception 'Only a draft can be published'; end if;
  if a.client_id is null then raise exception 'Link the agreement to a project and client first'; end if;
  if a.project_id is not null then
    mine := private.agreement_codes(a.doc);
    clash := array(select unnest(mine) intersect select unnest(private.locked_codes(a.project_id, a.id)));
    if cardinality(clash) > 0 then
      raise exception '% already in another published or signed agreement on this project. Leave % out of this one.', array_to_string(clash, ', '), case when cardinality(clash) = 1 then 'it' else 'them' end;
    end if;
    pt := (select coalesce(sum(fee), 0) from phases where project_id = a.project_id and code::text = any(mine));
    if not private.fee_locked(a.project_id) and coalesce(jsonb_typeof(a.doc->'split'), '') <> 'object' then
      pt := private.phase_fee_total(a.project_id); -- agreements without a fee-by-phase split: all the project's phases
    end if;
    if abs(pt - coalesce(a.total_fee, 0)) >= 0.05 then
      raise exception 'This agreement''s phases add up to $% on the project but its fee is $%. Fix the fee by phase (or the project''s phases) before publishing.',
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
