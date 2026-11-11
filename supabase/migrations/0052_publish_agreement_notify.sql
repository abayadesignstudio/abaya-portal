-- Publishing an agreement can skip telling the client (Joshua sends it himself).
drop function if exists public.publish_agreement(uuid, integer[], text);
create or replace function public.publish_agreement(p_id uuid, p_sections integer[], p_logo text, p_notify boolean default true)
returns text language plpgsql security definer set search_path to 'public' as $function$
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
  if a.project_id is not null and p_notify then
    insert into updates (project_id, author, kind, title, body, visible_to_client, notify)
    values (a.project_id, auth.uid(), 'memo', 'Your agreement is ready to sign',
      'Please review the agreement in your portal, initial each section and sign it there.', true, 'now');
  end if;
  return h;
end $function$;
revoke all on function public.publish_agreement(uuid, integer[], text, boolean) from public, anon;
grant execute on function public.publish_agreement(uuid, integer[], text, boolean) to authenticated;
