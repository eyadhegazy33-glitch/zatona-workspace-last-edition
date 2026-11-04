create or replace function public.get_live_timers()
returns table (
  checkin_id bigint,
  customer_id uuid,
  customer_name text,
  customer_code text,
  is_inside boolean,
  resource_name text,
  checked_in_at timestamptz,
  deadline timestamptz,
  warning_at timestamptz,
  overdue_at timestamptz,
  state text,
  seconds_left integer,
  fees_due numeric,
  server_now timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  w integer := public.ops_num('ops.timer_window_minutes', 180)::integer;
  wr integer := public.ops_num('ops.timer_warning_minutes', 15)::integer;
  v_grace integer := public.ops_num('ops.timer_grace_minutes', 0)::integer;
begin
  if not coalesce(public.has_permission('timers.view'), false) then
    raise exception 'not allowed';
  end if;

  return query
  select
    k.id,
    c.id,
    c.first_name || ' ' || c.last_name,
    c.code,
    true,
    r.name,
    k.checked_in_at,
    d.deadline,
    d.deadline - make_interval(mins => wr),
    d.deadline,
    case
      when now() >= d.deadline then 'overdue'
      when now() >= d.deadline - make_interval(mins => wr) then 'warning'
      else 'ok'
    end,
    extract(epoch from (d.deadline - now()))::integer,
    case
      when public.has_permission('fees.view') then coalesce((
        select sum(f.amount)
        from public.fees f
        where f.checkin_id = k.id
          and f.status = 'due'
      ), 0)
      else 0
    end,
    now()
  from public.checkins k
  join public.customers c on c.id = k.customer_id
  left join public.resources r on r.id = k.resource_id
  cross join lateral (
    select greatest(
      k.timer_started_at,
      coalesce(k.last_qualifying_order_at, k.timer_started_at)
    ) + make_interval(mins => w + v_grace) as deadline
  ) d
  where k.checked_out_at is null
  order by d.deadline;
end;
$$;

revoke execute on function public.get_live_timers() from public, anon;
grant execute on function public.get_live_timers() to authenticated;
