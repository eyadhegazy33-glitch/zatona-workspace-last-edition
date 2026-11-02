begin;

create extension if not exists btree_gist;
create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit text not null default 'unit',
  qty numeric(12, 2) not null default 0 check (qty >= 0),
  min_qty numeric(12, 2) not null default 0 check (min_qty >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint inventory_item_name_length check (length(btrim(name)) between 1 and 100),
  constraint inventory_item_unit_length check (length(btrim(unit)) between 1 and 30)
);

create table if not exists public.inventory_movements (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.inventory_items(id),
  change numeric(12, 2) not null check (change <> 0),
  qty_after numeric(12, 2) not null check (qty_after >= 0),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists inventory_movements_item_idx
  on public.inventory_movements (item_id, created_at desc);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  resource_id uuid not null references public.resources(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  people integer not null default 1 check (people between 1 and 200),
  notes text,
  deposit numeric(10, 2) not null default 0 check (deposit >= 0),
  status text not null default 'confirmed'
    check (status in ('pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show')),
  cancel_reason text,
  reminded_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  constraint bookings_no_overlap exclude using gist
    (resource_id with =, tstzrange(starts_at, ends_at) with &&)
    where (status in ('pending', 'confirmed', 'checked_in'))
);

create index if not exists bookings_time_idx on public.bookings (starts_at);
create index if not exists bookings_customer_time_idx
  on public.bookings (customer_id, starts_at desc);

insert into public.settings (key, value) values
  ('ops.booking_max_hours', '4'::jsonb),
  ('ops.booking_max_days', '30'::jsonb),
  ('ops.booking_noshow_minutes', '15'::jsonb)
on conflict (key) do nothing;

insert into public.permissions (key, description) values
  ('inventory.view', 'See stock'),
  ('inventory.manage', 'Create stock items and set minimum levels'),
  ('inventory.adjust', 'Add or remove stock with a reason'),
  ('bookings.view', 'See bookings'),
  ('bookings.manage', 'Create, edit, cancel bookings')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select role_row.id, permission_row.key
from public.roles role_row
cross join public.permissions permission_row
where role_row.name = 'Admin'
  and permission_row.key in (
    'inventory.view', 'inventory.manage', 'inventory.adjust',
    'bookings.view', 'bookings.manage'
  )
on conflict (role_id, permission_key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select role_row.id, permission_row.permission_key
from public.roles role_row
join (values
  ('Manager', 'inventory.view'),
  ('Manager', 'inventory.manage'),
  ('Manager', 'inventory.adjust'),
  ('Manager', 'bookings.view'),
  ('Manager', 'bookings.manage'),
  ('Reception', 'bookings.view'),
  ('Reception', 'bookings.manage'),
  ('Barista', 'inventory.view'),
  ('Barista', 'inventory.adjust')
) as permission_row(role_name, permission_key)
  on permission_row.role_name = role_row.name
on conflict (role_id, permission_key) do nothing;

alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.bookings enable row level security;

drop policy if exists inventory_items_read on public.inventory_items;
create policy inventory_items_read on public.inventory_items
  for select to authenticated
  using (
    public.has_permission('inventory.view')
    or public.has_permission('inventory.manage')
  );

drop policy if exists inventory_movements_read on public.inventory_movements;
create policy inventory_movements_read on public.inventory_movements
  for select to authenticated
  using (public.has_permission('inventory.manage'));

drop policy if exists bookings_read on public.bookings;
create policy bookings_read on public.bookings
  for select to authenticated
  using (public.has_permission('bookings.view'));

revoke all on public.inventory_items, public.inventory_movements, public.bookings
  from public, anon, authenticated;
grant select on public.inventory_items, public.inventory_movements, public.bookings
  to authenticated;

create or replace function public.prevent_inventory_movement_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception using errcode = '55000',
    message = 'inventory movements cannot be changed or deleted';
end;
$$;

drop trigger if exists inventory_movements_immutable on public.inventory_movements;
create trigger inventory_movements_immutable
before update or delete on public.inventory_movements
for each row execute function public.prevent_inventory_movement_change();

create or replace function public.save_inventory_item(
  p_id uuid,
  p_name text,
  p_unit text,
  p_min_qty numeric,
  p_active boolean default true
)
returns public.inventory_items
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_item public.inventory_items;
  v_name text := nullif(btrim(p_name), '');
  v_unit text := coalesce(nullif(btrim(p_unit), ''), 'unit');
  v_min numeric(12, 2) := coalesce(p_min_qty, 0);
begin
  if not coalesce(public.has_permission('inventory.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if v_name is null or length(v_name) > 100
     or length(v_unit) > 30
     or p_min_qty is null or v_min < 0 or p_min_qty <> round(p_min_qty, 2)
     or p_active is null then
    raise exception using errcode = '22023', message = 'invalid inventory item';
  end if;

  if p_id is null then
    insert into public.inventory_items (name, unit, min_qty, active)
    values (v_name, v_unit, v_min, p_active)
    returning * into v_item;
  else
    update public.inventory_items
    set name = v_name,
        unit = v_unit,
        min_qty = v_min,
        active = p_active
    where id = p_id
    returning * into v_item;
    if not found then
      raise exception using errcode = 'P0002', message = 'item not found';
    end if;
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(),
    'inventory.save',
    'inventory_item',
    v_item.id::text,
    jsonb_build_object(
      'name', v_item.name,
      'unit', v_item.unit,
      'min_qty', v_item.min_qty,
      'active', v_item.active
    )
  );

  return v_item;
end;
$$;

create or replace function public.adjust_stock(
  p_item uuid,
  p_change numeric,
  p_reason text
)
returns numeric
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_item public.inventory_items;
  v_new_qty numeric(12, 2);
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not (
    coalesce(public.has_permission('inventory.adjust'), false)
    or coalesce(public.has_permission('inventory.manage'), false)
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_change is null or p_change = 0
     or p_change <> round(p_change, 2)
     or length(v_reason) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'valid stock change and reason required';
  end if;

  select *
  into v_item
  from public.inventory_items
  where id = p_item and active
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'item not found';
  end if;

  v_new_qty := v_item.qty + p_change;
  if v_new_qty < 0 then
    raise exception using errcode = '22023', message = 'stock cannot be negative';
  end if;

  update public.inventory_items
  set qty = v_new_qty
  where id = p_item;

  insert into public.inventory_movements (item_id, change, qty_after, reason, created_by)
  values (p_item, p_change, v_new_qty, v_reason, auth.uid());

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(),
    'inventory.adjust',
    'inventory_item',
    p_item::text,
    jsonb_build_object(
      'change', p_change,
      'qty_before', v_item.qty,
      'qty_after', v_new_qty,
      'reason', v_reason
    )
  );

  return v_new_qty;
end;
$$;

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
     or (v_customer.expires_on is not null and v_customer.expires_on < (p_starts at time zone v_timezone)::date) then
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
     or (v_customer.expires_on is not null and v_customer.expires_on < (p_starts at time zone v_timezone)::date) then
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

create or replace function public.set_booking_status(
  p_id uuid,
  p_status text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_booking public.bookings;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not coalesce(public.has_permission('bookings.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select *
  into v_booking
  from public.bookings
  where id = p_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'booking not found';
  end if;
  if not (
    (v_booking.status = 'pending' and p_status in ('confirmed', 'cancelled'))
    or (v_booking.status = 'confirmed' and p_status in ('cancelled', 'no_show'))
    or (v_booking.status = 'checked_in' and p_status = 'completed')
  ) or p_status is null then
    raise exception using errcode = '22023', message = 'invalid status change';
  end if;
  if p_status = 'cancelled' and length(v_reason) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'cancellation reason required';
  end if;

  update public.bookings
  set status = p_status,
      cancel_reason = case when p_status = 'cancelled' then v_reason else cancel_reason end
  where id = p_id;

  insert into public.audit_logs (actor_id, action, entity, entity_id, old_value, new_value)
  values (
    auth.uid(),
    'booking.status',
    'booking',
    p_id::text,
    jsonb_build_object('status', v_booking.status),
    jsonb_build_object(
      'status', p_status,
      'reason', case when p_status = 'cancelled' then v_reason else null end
    )
  );
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
  if not coalesce(public.has_permission('bookings.manage'), false)
     or not coalesce(public.has_permission('checkins.manage'), false) then
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

create or replace function public.process_bookings()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is not null then
    raise exception using errcode = '42501', message = 'scheduler only';
  end if;

  with updated as (
    update public.bookings
    set status = 'no_show'
    where status = 'confirmed'
      and starts_at + make_interval(mins => public.ops_num('ops.booking_noshow_minutes', 15)::integer) < now()
    returning id, status
  )
  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  select null, 'booking.status', 'booking', updated.id::text,
         jsonb_build_object('status', updated.status, 'source', 'scheduler')
  from updated;

  with updated as (
    update public.bookings
    set status = 'completed'
    where status = 'checked_in'
      and ends_at < now()
    returning id, status
  )
  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  select null, 'booking.status', 'booking', updated.id::text,
         jsonb_build_object('status', updated.status, 'source', 'scheduler')
  from updated;

  with due as (
    update public.bookings
    set reminded_at = now()
    where status = 'confirmed'
      and reminded_at is null
      and starts_at between now() and now() + interval '30 minutes'
    returning id, created_by, starts_at
  ),
  notifications as (
    insert into public.notifications (user_id, type, payload)
    select due.created_by, 'booking_reminder',
           jsonb_build_object('booking_id', due.id, 'starts_at', due.starts_at)
    from due
    where due.created_by is not null
    returning user_id
  )
  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  select null, 'booking.reminder', 'booking', due.id::text,
         jsonb_build_object('starts_at', due.starts_at, 'source', 'scheduler')
  from due;
end;
$$;

revoke all on function public.prevent_inventory_movement_change() from public, anon, authenticated;
revoke all on function public.save_inventory_item(uuid, text, text, numeric, boolean) from public, anon;
revoke all on function public.adjust_stock(uuid, numeric, text) from public, anon;
revoke all on function public.create_booking(uuid, uuid, timestamptz, timestamptz, integer, text, numeric) from public, anon;
revoke all on function public.update_booking(uuid, uuid, timestamptz, timestamptz, integer, text, numeric) from public, anon;
revoke all on function public.set_booking_status(uuid, text, text) from public, anon;
revoke all on function public.booking_check_in(uuid) from public, anon;
revoke all on function public.process_bookings() from public, anon, authenticated;

grant execute on function public.save_inventory_item(uuid, text, text, numeric, boolean) to authenticated;
grant execute on function public.adjust_stock(uuid, numeric, text) to authenticated;
grant execute on function public.create_booking(uuid, uuid, timestamptz, timestamptz, integer, text, numeric) to authenticated;
grant execute on function public.update_booking(uuid, uuid, timestamptz, timestamptz, integer, text, numeric) to authenticated;
grant execute on function public.set_booking_status(uuid, text, text) to authenticated;
grant execute on function public.booking_check_in(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'bookings'
  ) then
    alter publication supabase_realtime add table public.bookings;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'inventory_items'
  ) then
    alter publication supabase_realtime add table public.inventory_items;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'inventory_movements'
  ) then
    alter publication supabase_realtime add table public.inventory_movements;
  end if;
end;
$$;

select cron.schedule(
  'zatona-bookings',
  '*/5 * * * *',
  'select public.process_bookings()'
);

commit;
