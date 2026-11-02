begin;

create or replace function public.create_booking(
  p_customer uuid,
  p_resource uuid,
  p_starts timestamptz,
  p_ends timestamptz,
  p_people integer default 1,
  p_notes text default null,
  p_deposit numeric default 0
)
returns public.bookings
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_customer public.customers;
  v_resource public.resources;
  v_booking public.bookings;
  v_max_hours integer;
  v_max_days integer;
  v_timezone text;
  v_deposit numeric(10, 2) := coalesce(p_deposit, 0);
  v_notes text := nullif(btrim(p_notes), '');
begin
  if not coalesce(public.has_permission('bookings.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts
     or p_starts < now() - interval '5 minutes'
     or p_people is null or p_people < 1 or p_people > 200
     or p_deposit is null or v_deposit < 0
     or p_deposit <> round(p_deposit, 2)
     or length(coalesce(p_notes, '')) > 500 then
    raise exception using errcode = '22023', message = 'invalid booking details';
  end if;

  v_max_hours := greatest(1, public.ops_num('ops.booking_max_hours', 4)::integer);
  v_max_days := greatest(1, public.ops_num('ops.booking_max_days', 30)::integer);
  v_timezone := coalesce(
    public.ops_text('ops.time_zone', ''),
    public.ops_text('ops.timezone', ''),
    'Africa/Cairo'
  );
  if p_ends - p_starts > make_interval(hours => v_max_hours)
     or p_starts > now() + make_interval(days => v_max_days) then
    raise exception using errcode = '22023', message = 'booking is outside the allowed time window';
  end if;

  select *
  into v_customer
  from public.customers
  where id = p_customer and deleted_at is null;
  if not found or v_customer.status <> 'active'
     or (v_customer.expiry_date is not null and v_customer.expiry_date < (p_starts at time zone v_timezone)::date) then
    raise exception using errcode = 'P0002', message = 'customer not allowed';
  end if;

  select *
  into v_resource
  from public.resources
  where id = p_resource and active
  for share;
  if not found or v_resource.status <> 'available' then
    raise exception using errcode = 'P0002', message = 'resource not available';
  end if;
  if p_people > v_resource.capacity then
    raise exception using errcode = '22023', message = 'too many people for this place';
  end if;

  insert into public.bookings (
    customer_id, resource_id, starts_at, ends_at, people, notes, deposit, created_by
  )
  values (
    p_customer, p_resource, p_starts, p_ends, p_people, v_notes, v_deposit, auth.uid()
  )
  returning * into v_booking;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(),
    'booking.create',
    'booking',
    v_booking.id::text,
    jsonb_build_object(
      'resource_id', p_resource,
      'starts_at', p_starts,
      'ends_at', p_ends,
      'people', p_people,
      'deposit', v_deposit
    )
  );

  return v_booking;
exception
  when exclusion_violation then
    raise exception using errcode = '23P01', message = 'slot_taken';
end;
$$;

create or replace function public.update_booking(
  p_id uuid,
  p_resource uuid,
  p_starts timestamptz,
  p_ends timestamptz,
  p_people integer,
  p_notes text,
  p_deposit numeric
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_booking public.bookings;
  v_customer public.customers;
  v_resource public.resources;
  v_max_hours integer;
  v_max_days integer;
  v_timezone text;
  v_deposit numeric(10, 2) := coalesce(p_deposit, 0);
  v_notes text := nullif(btrim(p_notes), '');
begin
  if not coalesce(public.has_permission('bookings.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select *
  into v_booking
  from public.bookings
  where id = p_id
  for update;
  if not found or v_booking.status not in ('pending', 'confirmed') then
    raise exception using errcode = 'P0002', message = 'booking cannot be edited';
  end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts
     or p_starts < now() - interval '5 minutes'
     or p_people is null or p_people < 1 or p_people > 200
     or p_deposit is null or v_deposit < 0
     or p_deposit <> round(p_deposit, 2)
     or length(coalesce(p_notes, '')) > 500 then
    raise exception using errcode = '22023', message = 'invalid booking details';
  end if;

  v_max_hours := greatest(1, public.ops_num('ops.booking_max_hours', 4)::integer);
  v_max_days := greatest(1, public.ops_num('ops.booking_max_days', 30)::integer);
  v_timezone := coalesce(
    public.ops_text('ops.time_zone', ''),
    public.ops_text('ops.timezone', ''),
    'Africa/Cairo'
  );
  if p_ends - p_starts > make_interval(hours => v_max_hours)
     or p_starts > now() + make_interval(days => v_max_days) then
    raise exception using errcode = '22023', message = 'booking is outside the allowed time window';
  end if;

  select *
  into v_customer
  from public.customers
  where id = v_booking.customer_id and deleted_at is null;
  if not found or v_customer.status <> 'active'
     or (v_customer.expiry_date is not null and v_customer.expiry_date < (p_starts at time zone v_timezone)::date) then
    raise exception using errcode = 'P0002', message = 'customer not allowed';
  end if;

  select *
  into v_resource
  from public.resources
  where id = p_resource and active
  for share;
  if not found or v_resource.status <> 'available' then
    raise exception using errcode = 'P0002', message = 'resource not available';
  end if;
  if p_people > v_resource.capacity then
    raise exception using errcode = '22023', message = 'too many people for this place';
  end if;

  update public.bookings
  set resource_id = p_resource,
      starts_at = p_starts,
      ends_at = p_ends,
      people = p_people,
      notes = v_notes,
      deposit = v_deposit,
      reminded_at = null
  where id = p_id;

  insert into public.audit_logs (
    actor_id, action, entity, entity_id, old_value, new_value
  )
  values (
    auth.uid(),
    'booking.update',
    'booking',
    p_id::text,
    jsonb_build_object(
      'resource_id', v_booking.resource_id,
      'starts_at', v_booking.starts_at,
      'ends_at', v_booking.ends_at,
      'people', v_booking.people,
      'deposit', v_booking.deposit
    ),
    jsonb_build_object(
      'resource_id', p_resource,
      'starts_at', p_starts,
      'ends_at', p_ends,
      'people', p_people,
      'deposit', v_deposit
    )
  );
exception
  when exclusion_violation then
    raise exception using errcode = '23P01', message = 'slot_taken';
end;
$$;

revoke all on function public.create_booking(uuid, uuid, timestamptz, timestamptz, integer, text, numeric) from public, anon;
revoke all on function public.update_booking(uuid, uuid, timestamptz, timestamptz, integer, text, numeric) from public, anon;
grant execute on function public.create_booking(uuid, uuid, timestamptz, timestamptz, integer, text, numeric) to authenticated;
grant execute on function public.update_booking(uuid, uuid, timestamptz, timestamptz, integer, text, numeric) to authenticated;

commit;
