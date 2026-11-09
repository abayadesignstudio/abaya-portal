-- Admins can keep timesheet rows for anyone (entering hours on someone's behalf).
create policy "admins manage anyone's rows" on public.timesheet_rows for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
