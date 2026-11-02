begin;

drop policy if exists shifts_manage_write on public.shifts;
create policy shifts_manage_write on public.shifts
  for all to authenticated
  using (public.has_permission('shifts.manage'))
  with check (public.has_permission('shifts.manage'));

drop policy if exists assignments_manage_write on public.shift_assignments;
create policy assignments_manage_write on public.shift_assignments
  for all to authenticated
  using (public.has_permission('shifts.manage'))
  with check (public.has_permission('shifts.manage'));

grant insert, update on public.shifts to authenticated;
grant insert, update on public.shift_assignments to authenticated;

commit;
