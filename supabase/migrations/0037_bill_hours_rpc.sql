create or replace function public.bill_hours(p_invoice uuid, p_entries uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_staff() then raise exception 'not allowed'; end if;
  update public.time_entries set invoice_id = null where invoice_id = p_invoice and not (id = any(coalesce(p_entries, '{}')));
  update public.time_entries set invoice_id = p_invoice where id = any(coalesce(p_entries, '{}')) and (invoice_id is null or invoice_id = p_invoice);
end $$;
revoke all on function public.bill_hours(uuid, uuid[]) from public, anon;
grant execute on function public.bill_hours(uuid, uuid[]) to authenticated;
