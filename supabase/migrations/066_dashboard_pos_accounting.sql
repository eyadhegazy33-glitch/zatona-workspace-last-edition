begin;

create index if not exists pos_receipts_issued_at_idx
  on public.pos_receipts (issued_at desc);
create index if not exists pos_orders_created_at_idx
  on public.pos_orders (created_at desc);

create or replace function public.dashboard_summary(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_grace int := public.ops_num('ops.timer_grace_minutes', 0)::int;
begin
  if not public.has_permission('dashboard.view') then raise exception 'not allowed'; end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'invalid range';
  end if;

  return jsonb_build_object(
    'revenue', coalesce((
      select sum(total) from public.receipts
      where status = 'paid' and created_at >= p_from and created_at < p_to
    ), 0) + coalesce((
      select sum(r.total)
      from public.pos_receipts r
      where r.issued_at >= p_from and r.issued_at < p_to
        and not exists (
          select 1 from public.pos_receipt_voids v where v.receipt_id = r.id
        )
    ), 0),
    'revenue_orders', coalesce((
      select sum(l.amount)
      from public.receipt_lines l
      join public.receipts r on r.id = l.receipt_id
      where r.status = 'paid' and l.line_type = 'order'
        and r.created_at >= p_from and r.created_at < p_to
    ), 0) + coalesce((
      select sum(r.total)
      from public.pos_receipts r
      where r.order_id is not null and r.issued_at >= p_from and r.issued_at < p_to
        and not exists (
          select 1 from public.pos_receipt_voids v where v.receipt_id = r.id
        )
    ), 0),
    'revenue_fees', coalesce((
      select sum(l.amount)
      from public.receipt_lines l
      join public.receipts r on r.id = l.receipt_id
      where r.status = 'paid' and l.line_type = 'fee'
        and r.created_at >= p_from and r.created_at < p_to
    ), 0) + coalesce((
      select sum(r.total)
      from public.pos_receipts r
      where r.order_id is null and r.issued_at >= p_from and r.issued_at < p_to
        and not exists (
          select 1 from public.pos_receipt_voids v where v.receipt_id = r.id
        )
    ), 0),
    'receipts_count', (
      select count(*) from public.receipts
      where status = 'paid' and created_at >= p_from and created_at < p_to
    ) + (
      select count(*)
      from public.pos_receipts r
      where r.issued_at >= p_from and r.issued_at < p_to
        and not exists (
          select 1 from public.pos_receipt_voids v where v.receipt_id = r.id
        )
    ),
    'voided_count', (
      select count(*) from public.receipts
      where status = 'voided' and created_at >= p_from and created_at < p_to
    ) + (
      select count(*)
      from public.pos_receipt_voids v
      join public.pos_receipts r on r.id = v.receipt_id
      where v.voided_at >= p_from and v.voided_at < p_to
    ),
    'orders_count', (
      select count(*) from public.orders
      where status <> 'cancelled' and created_at >= p_from and created_at < p_to
    ) + (
      select count(*) from public.pos_orders
      where status not in ('cancelled', 'voided')
        and created_at >= p_from and created_at < p_to
    ),
    'inside_now', (
      select count(*) from public.checkins where checked_out_at is null
    ),
    'overdue_now', (
      select count(*) from public.checkins k
      where k.checked_out_at is null
        and now() >= public.checkin_deadline(k) + make_interval(mins => v_grace)
    ),
    'open_incidents', (
      select count(*) from public.incidents where status in ('open', 'assigned', 'in_progress')
    ),
    'open_alerts', (
      select count(*) from public.alerts where status in ('open', 'acknowledged')
    ),
    'low_stock', (
      select count(*) from public.inventory_items where active and qty <= min_qty
    ),
    'occupancy', (
      select jsonb_build_object(
        'seats_total', count(*) filter (where r.type = 'seat'),
        'seats_used', count(*) filter (where r.type = 'seat' and u.used),
        'rooms_total', count(*) filter (where r.type = 'room'),
        'rooms_used', count(*) filter (where r.type = 'room' and u.used),
        'tables_total', count(*) filter (where r.type = 'table'),
        'tables_used', count(*) filter (where r.type = 'table' and u.used)
      )
      from public.resources r
      cross join lateral (
        select exists (
          select 1 from public.checkins k
          where k.resource_id = r.id and k.checked_out_at is null
        ) as used
      ) u
      where r.active and r.status = 'available'
    ),
    'resources_in_maintenance', (
      select count(*) from public.resources where active and status = 'maintenance'
    )
  );
end $$;

create or replace function public.revenue_by_hour(p_day date)
returns table (hr int, revenue numeric, receipts_count int)
language plpgsql security definer stable set search_path = public as $$
declare
  tz text := public.ops_text('ops.timezone', 'Africa/Cairo');
begin
  if not public.has_permission('dashboard.view') then raise exception 'not allowed'; end if;
  if p_day is null then raise exception 'invalid day'; end if;
  return query
  select h,
         (
           coalesce((
             select sum(r.total)
             from public.receipts r
             where r.status = 'paid'
               and (r.created_at at time zone tz)::date = p_day
               and extract(hour from r.created_at at time zone tz)::int = h
           ), 0) + coalesce((
             select sum(r.total)
             from public.pos_receipts r
             where (r.issued_at at time zone tz)::date = p_day
               and extract(hour from r.issued_at at time zone tz)::int = h
               and not exists (
                 select 1 from public.pos_receipt_voids v where v.receipt_id = r.id
               )
           ), 0)
         )::numeric,
         (
           select count(*)::int
           from public.receipts r
           where r.status = 'paid'
             and (r.created_at at time zone tz)::date = p_day
             and extract(hour from r.created_at at time zone tz)::int = h
         ) + (
           select count(*)::int
           from public.pos_receipts r
           where (r.issued_at at time zone tz)::date = p_day
             and extract(hour from r.issued_at at time zone tz)::int = h
             and not exists (
               select 1 from public.pos_receipt_voids v where v.receipt_id = r.id
             )
         )
  from generate_series(0, 23) h
  order by h;
end $$;

create or replace function public.revenue_by_day(p_from date, p_to date)
returns table (day_date date, revenue numeric, fees numeric, receipts_count int)
language plpgsql security definer stable set search_path = public as $$
declare
  tz text := public.ops_text('ops.timezone', 'Africa/Cairo');
begin
  if not public.has_permission('dashboard.view') then raise exception 'not allowed'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'invalid range';
  end if;
  return query
  select g::date,
    (
      coalesce((
        select sum(r.total) from public.receipts r
        where r.status = 'paid' and (r.created_at at time zone tz)::date = g::date
      ), 0) + coalesce((
        select sum(r.total)
        from public.pos_receipts r
        where (r.issued_at at time zone tz)::date = g::date
          and not exists (
            select 1 from public.pos_receipt_voids v where v.receipt_id = r.id
          )
      ), 0)
    )::numeric,
    (
      coalesce((
        select sum(l.amount)
        from public.receipt_lines l
        join public.receipts r on r.id = l.receipt_id
        where r.status = 'paid' and l.line_type = 'fee'
          and (r.created_at at time zone tz)::date = g::date
      ), 0) + coalesce((
        select sum(r.total)
        from public.pos_receipts r
        where r.order_id is null
          and (r.issued_at at time zone tz)::date = g::date
          and not exists (
            select 1 from public.pos_receipt_voids v where v.receipt_id = r.id
          )
      ), 0)
    )::numeric,
    (
      select count(*)::int from public.receipts r
      where r.status = 'paid' and (r.created_at at time zone tz)::date = g::date
    ) + (
      select count(*)::int
      from public.pos_receipts r
      where (r.issued_at at time zone tz)::date = g::date
        and not exists (
          select 1 from public.pos_receipt_voids v where v.receipt_id = r.id
        )
    )
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
  order by 1;
end $$;

create or replace function public.orders_per_user(p_from timestamptz, p_to timestamptz)
returns table (user_name text, orders_count bigint, total numeric)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.has_permission('dashboard.view') then raise exception 'not allowed'; end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'invalid range';
  end if;
  return query
  select activity.name, sum(activity.order_count)::bigint, sum(activity.total)::numeric
  from (
    select p.first_name || ' ' || p.last_name as name,
           count(*)::bigint as order_count,
           coalesce(sum(o.total), 0)::numeric as total
    from public.orders o
    join public.profiles p on p.id = o.created_by
    where o.status <> 'cancelled' and o.created_at >= p_from and o.created_at < p_to
    group by p.id, p.first_name, p.last_name
    union all
    select p.first_name || ' ' || p.last_name as name,
           count(*)::bigint as order_count,
           coalesce(sum(o.total), 0)::numeric as total
    from public.pos_orders o
    join public.profiles p on p.id = o.created_by
    where o.status not in ('cancelled', 'voided')
      and o.created_at >= p_from and o.created_at < p_to
    group by p.id, p.first_name, p.last_name
  ) activity
  group by activity.name
  order by 2 desc;
end $$;

revoke execute on function public.dashboard_summary(timestamptz, timestamptz) from public, anon;
revoke execute on function public.revenue_by_hour(date) from public, anon;
revoke execute on function public.revenue_by_day(date, date) from public, anon;
revoke execute on function public.orders_per_user(timestamptz, timestamptz) from public, anon;

grant execute on function public.dashboard_summary(timestamptz, timestamptz) to authenticated;
grant execute on function public.revenue_by_hour(date) to authenticated;
grant execute on function public.revenue_by_day(date, date) to authenticated;
grant execute on function public.orders_per_user(timestamptz, timestamptz) to authenticated;

commit;
