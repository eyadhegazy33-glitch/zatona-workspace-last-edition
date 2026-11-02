begin;

create or replace function public.get_visit_timer(p_checkin bigint)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_checkin public.checkins;
  v_duration integer;
  v_warning integer;
  v_deadline timestamptz;
begin
  if not (
    coalesce(public.has_permission('checkins.manage'), false)
    or coalesce(public.has_permission('scanner.use'), false)
    or coalesce(public.has_permission('orders.create'), false)
    or coalesce(public.has_permission('orders.manage'), false)
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select *
    into v_checkin
  from public.checkins
  where id = p_checkin
    and checked_out_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'open visit not found';
  end if;

  select coalesce((value #>> '{}')::integer, 180)
    into v_duration
  from public.settings
  where key = 'ops.visit_duration_minutes';

  select coalesce((value #>> '{}')::integer, 15)
    into v_warning
  from public.settings
  where key = 'ops.timer_warning_minutes';

  v_deadline := greatest(
    v_checkin.timer_started_at,
    coalesce(v_checkin.last_qualifying_order_at, v_checkin.timer_started_at)
  ) + make_interval(mins => coalesce(v_duration, 180));

  return jsonb_build_object(
    'deadline', v_deadline,
    'warning_at', v_deadline - make_interval(mins => coalesce(v_warning, 15)),
    'server_now', now()
  );
end;
$$;

revoke all on function public.get_visit_timer(bigint) from public, anon;
grant execute on function public.get_visit_timer(bigint) to authenticated;

notify pgrst, 'reload schema';

commit;
