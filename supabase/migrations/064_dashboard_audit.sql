begin;

insert into public.permissions (key, description) values
  ('dashboard.occupancy', 'See seats and rooms in use'),
  ('audit.export', 'Export the audit log')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.name = 'Admin'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, x.key
from public.roles r
join (values
  ('Manager', 'dashboard.occupancy'),
  ('Reception', 'dashboard.occupancy')
) as x(role, key) on x.role = r.name
on conflict do nothing;

create index if not exists receipts_status_created_idx
  on public.receipts (status, created_at);
create index if not exists checkins_checked_in_idx
  on public.checkins (checked_in_at);

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
    ), 0),
    'revenue_orders', coalesce((
      select sum(l.amount)
      from public.receipt_lines l
      join public.receipts r on r.id = l.receipt_id
      where r.status = 'paid' and l.line_type = 'order'
        and r.created_at >= p_from and r.created_at < p_to
    ), 0),
    'revenue_fees', coalesce((
      select sum(l.amount)
      from public.receipt_lines l
      join public.receipts r on r.id = l.receipt_id
      where r.status = 'paid' and l.line_type = 'fee'
        and r.created_at >= p_from and r.created_at < p_to
    ), 0),
    'receipts_count', (
      select count(*) from public.receipts
      where status = 'paid' and created_at >= p_from and created_at < p_to
    ),
    'voided_count', (
      select count(*) from public.receipts
      where status = 'voided' and created_at >= p_from and created_at < p_to
    ),
    'orders_count', (
      select count(*) from public.orders
      where status <> 'cancelled' and created_at >= p_from and created_at < p_to
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

create or replace function public.occupancy_now()
returns table (
  resource_id uuid,
  name text,
  type text,
  capacity int,
  status text,
  people int,
  names text[]
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (
    public.has_permission('dashboard.view')
    or public.has_permission('dashboard.occupancy')
  ) then
    raise exception 'not allowed';
  end if;
  return query
  select r.id,
         r.name,
         r.type,
         r.capacity,
         r.status,
         (
           select count(*)::int from public.checkins k
           where k.resource_id = r.id and k.checked_out_at is null
         ),
         case when public.has_permission('customers.view') then (
           select array_agg(c.first_name || ' ' || left(c.last_name, 1) || '.')
           from public.checkins k
           join public.customers c on c.id = k.customer_id
           where k.resource_id = r.id and k.checked_out_at is null
         ) else null end
  from public.resources r
  where r.active
  order by r.type, r.name;
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
         coalesce(sum(r.total), 0)::numeric,
         count(r.id)::int
  from generate_series(0, 23) h
  left join public.receipts r
    on r.status = 'paid'
   and (r.created_at at time zone tz)::date = p_day
   and extract(hour from r.created_at at time zone tz)::int = h
  group by h
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
    coalesce((
      select sum(r.total) from public.receipts r
      where r.status = 'paid' and (r.created_at at time zone tz)::date = g::date
    ), 0)::numeric,
    coalesce((
      select sum(l.amount)
      from public.receipt_lines l
      join public.receipts r on r.id = l.receipt_id
      where r.status = 'paid' and l.line_type = 'fee'
        and (r.created_at at time zone tz)::date = g::date
    ), 0)::numeric,
    (
      select count(*)::int from public.receipts r
      where r.status = 'paid' and (r.created_at at time zone tz)::date = g::date
    )
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
  order by 1;
end $$;

create or replace function public.top_items(
  p_from timestamptz,
  p_to timestamptz,
  p_limit int default 10
)
returns table (item_name text, qty numeric, revenue numeric)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.has_permission('dashboard.view') then raise exception 'not allowed'; end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'invalid range';
  end if;
  return query
  select i.product_name_en,
         sum(i.quantity)::numeric,
         sum(i.line_total)::numeric
  from public.pos_order_items i
  join public.pos_orders o on o.id = i.order_id
  where o.status = 'paid' and o.created_at >= p_from and o.created_at < p_to
  group by i.product_name_en
  order by 2 desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
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
  select p.first_name || ' ' || p.last_name,
         count(*)::bigint,
         coalesce(sum(o.total), 0)::numeric
  from public.orders o
  join public.profiles p on p.id = o.created_by
  where o.status <> 'cancelled' and o.created_at >= p_from and o.created_at < p_to
  group by p.id, p.first_name, p.last_name
  order by 2 desc;
end $$;

create or replace function public.occupancy_by_hour(p_day date)
returns table (hr int, people int)
language plpgsql security definer stable set search_path = public as $$
declare
  tz text := public.ops_text('ops.timezone', 'Africa/Cairo');
begin
  if not (
    public.has_permission('dashboard.view')
    or public.has_permission('dashboard.occupancy')
  ) then
    raise exception 'not allowed';
  end if;
  if p_day is null then raise exception 'invalid day'; end if;
  return query
  select h,
    case
      when ((p_day::timestamp + make_interval(hours => h)) at time zone tz) > now() then null
      else (
        select count(*)::int
        from public.checkins k
        where k.checked_in_at < ((p_day::timestamp + make_interval(hours => h + 1)) at time zone tz)
          and (
            k.checked_out_at is null
            or k.checked_out_at > ((p_day::timestamp + make_interval(hours => h)) at time zone tz)
          )
      )
    end
  from generate_series(0, 23) h
  order by h;
end $$;

alter table public.audit_logs add column if not exists actor_role text;
alter table public.audit_logs add column if not exists ip text;
alter table public.audit_logs add column if not exists user_agent text;

create index if not exists audit_logs_created_idx
  on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_idx
  on public.audit_logs (actor_id, created_at desc);
create index if not exists audit_logs_action_idx
  on public.audit_logs (action);

create or replace function public.audit_enrich()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  h json;
begin
  begin
    h := current_setting('request.headers', true)::json;
  exception when others then
    h := null;
  end;
  new.ip := coalesce(
    new.ip,
    nullif(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1), '')
  );
  new.user_agent := coalesce(new.user_agent, left(h->>'user-agent', 300));
  new.actor_role := coalesce(
    new.actor_role,
    (
      select r.name
      from public.profiles p
      join public.roles r on r.id = p.role_id
      where p.id = new.actor_id
    )
  );
  return new;
end $$;

drop trigger if exists audit_enrich_trg on public.audit_logs;
create trigger audit_enrich_trg
before insert on public.audit_logs
for each row execute function public.audit_enrich();

drop trigger if exists audit_no_change on public.audit_logs;
create trigger audit_no_change
before update or delete on public.audit_logs
for each row execute function public.prevent_change();

revoke update, delete, truncate on public.audit_logs from anon, authenticated;

create or replace function public.audit_suspicious(p_days int default 7)
returns setof public.audit_logs
language plpgsql security definer stable set search_path = public as $$
declare
  tz text := public.ops_text('ops.timezone', 'Africa/Cairo');
begin
  if not public.has_permission('audit.view') then raise exception 'not allowed'; end if;
  return query
  select a.*
  from public.audit_logs a
  where a.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90))
    and (
      a.action ilike any (array['%void%', '%waive%', '%rollback%', '%reissue%', '%permission%', '%role%'])
      or (
        a.action ilike any (array['%delete%', '%approve%', '%setting%', '%suspend%'])
        and extract(hour from a.created_at at time zone tz) between 0 and 5
      )
    )
  order by a.created_at desc
  limit 500;
end $$;

revoke execute on function public.dashboard_summary(timestamptz, timestamptz) from public, anon;
revoke execute on function public.occupancy_now() from public, anon;
revoke execute on function public.revenue_by_hour(date) from public, anon;
revoke execute on function public.revenue_by_day(date, date) from public, anon;
revoke execute on function public.top_items(timestamptz, timestamptz, int) from public, anon;
revoke execute on function public.orders_per_user(timestamptz, timestamptz) from public, anon;
revoke execute on function public.occupancy_by_hour(date) from public, anon;
revoke execute on function public.audit_suspicious(int) from public, anon;

grant execute on function public.dashboard_summary(timestamptz, timestamptz) to authenticated;
grant execute on function public.occupancy_now() to authenticated;
grant execute on function public.revenue_by_hour(date) to authenticated;
grant execute on function public.revenue_by_day(date, date) to authenticated;
grant execute on function public.top_items(timestamptz, timestamptz, int) to authenticated;
grant execute on function public.orders_per_user(timestamptz, timestamptz) to authenticated;
grant execute on function public.occupancy_by_hour(date) to authenticated;
grant execute on function public.audit_suspicious(int) to authenticated;

commit;
