-- Clients see their project's milestones and deliverables on the schedule.
create policy "client reads milestones" on public.milestones for select to authenticated using (private.client_can_see_project(project_id));
create policy "client reads deliverables" on public.deliverables for select to authenticated using (private.client_can_see_project(project_id));
