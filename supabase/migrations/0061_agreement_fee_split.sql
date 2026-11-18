-- 0061 Phase fees come from the agreement's "fee by phase" split (doc.split: { "SD": "15", … } as % of the total),
-- so the payment schedule can group phases (or be two payments) without changing the phases.
-- Agreements without a split keep 0060's behaviour (one payment per phase, or percentage phases follow the total).
create or replace function private.sync_phases_from_agreement() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record; n int; mapped int; t numeric := coalesce(new.total_fee, 0); ssum numeric := 0;
begin
  if new.project_id is null or new.status <> 'draft' or private.fee_locked(new.project_id) then return new; end if;

  if jsonb_typeof(new.doc->'split') = 'object' then
    select coalesce(sum(coalesce(nullif(regexp_replace(e.value, '[^0-9.]', '', 'g'), '')::numeric, 0)), 0) into ssum
      from jsonb_each_text(new.doc->'split') e
      where e.key in ('CE','SD','DD','CD','BN','PM','CA') and coalesce(new.doc->'ph'->e.key->>'on', 'false') = 'true';
  end if;
  if ssum > 0 then
    for r in select e.key as c, coalesce(nullif(regexp_replace(e.value, '[^0-9.]', '', 'g'), '')::numeric, 0) as pct
             from jsonb_each_text(new.doc->'split') e
             where e.key in ('CE','SD','DD','CD','BN','PM','CA') and coalesce(new.doc->'ph'->e.key->>'on', 'false') = 'true' loop
      continue when r.pct = 0;
      update public.phases set fee = round(t * r.pct / 100, 2), fee_pct = null
        where project_id = new.project_id and code::text = r.c and (fee is distinct from round(t * r.pct / 100, 2) or fee_pct is not null);
      if not exists (select 1 from public.phases where project_id = new.project_id and code::text = r.c) then
        insert into public.phases (project_id, code, fee) values (new.project_id, r.c::public.phase_code, round(t * r.pct / 100, 2));
      end if;
    end loop;
    update public.phases set fee = 0, fee_pct = null
      where project_id = new.project_id and code::text in ('CE','SD','DD','CD','BN','PM','CA') and fee <> 0
        and code::text not in (select e.key from jsonb_each_text(new.doc->'split') e
          where coalesce(nullif(regexp_replace(e.value, '[^0-9.]', '', 'g'), '')::numeric, 0) > 0 and coalesce(new.doc->'ph'->e.key->>'on', 'false') = 'true');
    return new;
  end if;

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
