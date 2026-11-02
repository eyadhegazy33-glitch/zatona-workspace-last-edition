begin;

insert into public.role_permissions (role_id, permission_key)
select role_row.id, permission_row.permission_key
from public.roles role_row
cross join (values ('bookings.view'), ('bookings.manage')) as permission_row(permission_key)
where role_row.name = 'owner'
on conflict (role_id, permission_key) do nothing;

create or replace function public.list_bookings(
  p_from timestamptz,
  p_to timestamptz,
  p_resource uuid default null,
  p_status text default null,
  p_search text default null
)
returns table (
  id uuid,
  customer_id uuid,
  customer_name text,
  customer_code text,
  resource_id uuid,
  resource_name text,
  resource_type text,
  resource_capacity integer,
  starts_at timestamptz,
  ends_at timestamptz,
  people integer,
  notes text,
  deposit numeric,
  status text,
  cancel_reason text,
  created_by uuid,
  created_at timestamptz
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
begin
  if not coalesce(public.has_permission('bookings.view'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception using errcode = '22023', message = 'valid date range required';
  end if;
  if p_status is not null and p_status not in (
    'pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show'
  ) then
    raise exception using errcode = '22023', message = 'invalid status';
  end if;

  return query
  select booking.id,
         booking.customer_id,
         concat_ws(' ', customer.first_name, customer.last_name),
         customer.code,
         booking.resource_id,
         resource.name,
         resource.type,
         resource.capacity,
         booking.starts_at,
         booking.ends_at,
         booking.people,
         booking.notes,
         booking.deposit,
         booking.status,
         booking.cancel_reason,
         booking.created_by,
         booking.created_at
  from public.bookings booking
  join public.customers customer on customer.id = booking.customer_id
  join public.resources resource on resource.id = booking.resource_id
  where booking.starts_at < p_to
    and booking.ends_at > p_from
    and (p_resource is null or booking.resource_id = p_resource)
    and (p_status is null or booking.status = p_status)
    and (
      nullif(btrim(p_search), '') is null
      or customer.code ilike '%' || btrim(p_search) || '%'
      or customer.first_name ilike '%' || btrim(p_search) || '%'
      or customer.last_name ilike '%' || btrim(p_search) || '%'
      or concat_ws(' ', customer.first_name, customer.last_name) ilike '%' || btrim(p_search) || '%'
    )
  order by booking.starts_at, resource.type, resource.name
  limit 5000;
end;
$$;

create or replace function public.get_booking_resources()
returns table (
  id uuid,
  type text,
  name text,
  capacity integer,
  status text,
  occupied boolean
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
begin
  if not coalesce(public.has_permission('bookings.view'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  return query
  select resource.id,
         resource.type,
         resource.name,
         resource.capacity,
         resource.status,
         exists (
           select 1
           from public.checkins checkin
           where checkin.resource_id = resource.id
             and checkin.checked_out_at is null
         )
  from public.resources resource
  where resource.active
  order by resource.type, resource.name;
end;
$$;

create or replace function public.get_booking_settings()
returns table (
  currency_code text,
  time_zone text
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
begin
  if not coalesce(public.has_permission('bookings.view'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  return query
  select coalesce(
           nullif(public.ops_text('ops.currency_code', ''), ''),
           public.ops_text('ops.currency', 'EGP'),
           'EGP'
         ),
         coalesce(
           nullif(public.ops_text('ops.time_zone', ''), ''),
           public.ops_text('ops.timezone', 'Africa/Cairo'),
           'Africa/Cairo'
         );
end;
$$;

create or replace function public.search_booking_customers(p_search text)
returns table (
  id uuid,
  first_name text,
  last_name text,
  code text
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_search text := btrim(coalesce(p_search, ''));
begin
  if not coalesce(public.has_permission('bookings.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if length(v_search) < 2 then
    return;
  end if;

  return query
  select customer.id, customer.first_name, customer.last_name, customer.code
  from public.customers customer
  where customer.deleted_at is null
    and customer.status = 'active'
    and (
      customer.code ilike '%' || v_search || '%'
      or customer.first_name ilike '%' || v_search || '%'
      or customer.last_name ilike '%' || v_search || '%'
      or concat_ws(' ', customer.first_name, customer.last_name) ilike '%' || v_search || '%'
    )
  order by customer.last_name, customer.first_name
  limit 50;
end;
$$;

create or replace function public.check_in(
  p_customer uuid,
  p_resource uuid default null
)
returns public.checkins
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  c public.customers;
  r public.resources;
  v public.checkins;
begin
  if not (
    coalesce(public.has_permission('checkins.manage'), false)
    or coalesce(public.has_permission('scanner.use'), false)
    or coalesce(public.has_permission('orders.create'), false)
    or coalesce(public.has_permission('orders.manage'), false)
    or coalesce(public.has_permission('bookings.manage'), false)
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select * into c
  from public.customers
  where id = p_customer and deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'customer not found';
  end if;
  if c.status <> 'active'
     or (c.expiry_date is not null and c.expiry_date < current_date) then
    raise exception using errcode = '42501', message = 'customer not allowed to enter';
  end if;
  if exists (
    select 1 from public.checkins
    where customer_id = p_customer and checked_out_at is null
  ) then
    raise exception using errcode = '23505', message = 'already checked in';
  end if;
  if p_resource is not null then
    select * into r
    from public.resources
    where id = p_resource and active
    for update;
    if not found or r.status <> 'available' then
      raise exception using errcode = '22023', message = 'resource not available';
    end if;
    if (
      select count(*) from public.checkins
      where resource_id = p_resource and checked_out_at is null
    ) >= r.capacity then
      raise exception using errcode = 'P0001', message = 'resource is full';
    end if;
  end if;

  insert into public.checkins (
    customer_id, resource_id, created_by, scanned_by, timer_started_at
  ) values (
    p_customer, p_resource, auth.uid(), auth.uid(), pg_catalog.now()
  ) returning * into v;
  return v;
end;
$$;

create or replace function public.booking_check_in(p_booking uuid)
returns public.checkins
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_booking public.bookings;
  v_checkin public.checkins;
begin
  if not coalesce(public.has_permission('bookings.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select *
  into v_booking
  from public.bookings
  where id = p_booking and status = 'confirmed'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'booking not found or not confirmed';
  end if;
  if now() < v_booking.starts_at - interval '30 minutes'
     or now() > v_booking.ends_at then
    raise exception using errcode = '22023', message = 'not within the booking time';
  end if;

  select *
  into v_checkin
  from public.check_in(v_booking.customer_id, v_booking.resource_id);

  update public.bookings
  set status = 'checked_in'
  where id = v_booking.id;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(),
    'booking.check_in',
    'booking',
    v_booking.id::text,
    jsonb_build_object('checkin_id', v_checkin.id)
  );

  return v_checkin;
end;
$$;

revoke all on function public.list_bookings(timestamptz, timestamptz, uuid, text, text) from public, anon;
revoke all on function public.get_booking_resources() from public, anon;
revoke all on function public.get_booking_settings() from public, anon;
revoke all on function public.search_booking_customers(text) from public, anon;
revoke all on function public.check_in(uuid, uuid) from public, anon;
revoke all on function public.booking_check_in(uuid) from public, anon;

grant execute on function public.list_bookings(timestamptz, timestamptz, uuid, text, text) to authenticated;
grant execute on function public.get_booking_resources() to authenticated;
grant execute on function public.get_booking_settings() to authenticated;
grant execute on function public.search_booking_customers(text) to authenticated;
grant execute on function public.check_in(uuid, uuid) to authenticated;
grant execute on function public.booking_check_in(uuid) to authenticated;

commit;
