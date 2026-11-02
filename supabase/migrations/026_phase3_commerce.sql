begin;

create sequence if not exists public.receipt_number_seq;

create table if not exists public.pos_products (
  id uuid primary key default gen_random_uuid(),
  name_en text not null,
  name_ar text not null,
  price numeric(12, 2) not null check (price >= 0),
  qualifies_for_time boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_products_name_en_length check (length(btrim(name_en)) between 1 and 100),
  constraint pos_products_name_ar_length check (length(btrim(name_ar)) between 1 and 100)
);

create table if not exists public.pos_shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  opened_at timestamptz not null default now(),
  opening_cash numeric(12, 2) not null check (opening_cash >= 0),
  closed_at timestamptz,
  counted_cash numeric(12, 2),
  expected_cash numeric(12, 2),
  variance numeric(12, 2),
  constraint pos_shifts_closed_values check (
    (closed_at is null and counted_cash is null and expected_cash is null and variance is null)
    or (closed_at is not null and counted_cash >= 0 and expected_cash >= 0 and variance is not null)
  )
);

create unique index if not exists pos_shifts_one_open_per_user
  on public.pos_shifts(user_id) where closed_at is null;

create table if not exists public.pos_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  checkin_id bigint not null references public.checkins(id),
  shift_id uuid not null references public.pos_shifts(id),
  created_by uuid not null references public.profiles(id),
  status text not null default 'open' check (status in ('open', 'paid', 'cancelled', 'voided')),
  currency text not null,
  subtotal numeric(12, 2) not null check (subtotal >= 0),
  discount_type text check (discount_type in ('amount', 'percent')),
  discount_value numeric(12, 2) not null default 0 check (discount_value >= 0),
  discount_total numeric(12, 2) not null default 0 check (discount_total >= 0),
  discount_reason text,
  total numeric(12, 2) not null check (total >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  constraint pos_orders_discount_reason check (
    (discount_value = 0 and discount_reason is null)
    or (discount_value > 0 and length(btrim(discount_reason)) between 3 and 500)
  )
);

create table if not exists public.pos_order_items (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.pos_orders(id),
  product_id uuid not null references public.pos_products(id),
  product_name_en text not null,
  product_name_ar text not null,
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  quantity numeric(12, 3) not null check (quantity > 0),
  line_total numeric(12, 2) not null check (line_total >= 0),
  qualifies_for_time boolean not null
);

create table if not exists public.pos_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_no text not null unique,
  order_id uuid not null unique references public.pos_orders(id),
  shift_id uuid not null references public.pos_shifts(id),
  issued_by uuid not null references public.profiles(id),
  payment_method text not null check (payment_method in ('cash', 'card', 'other')),
  currency text not null,
  total numeric(12, 2) not null check (total >= 0),
  issued_at timestamptz not null default now()
);

create table if not exists public.pos_receipt_voids (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null unique references public.pos_receipts(id),
  voided_by uuid not null references public.profiles(id),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  voided_at timestamptz not null default now()
);

create table if not exists public.visit_fees (
  id uuid primary key default gen_random_uuid(),
  checkin_id bigint not null unique references public.checkins(id),
  shift_id uuid not null references public.pos_shifts(id),
  currency text not null,
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.visit_fee_waivers (
  id uuid primary key default gen_random_uuid(),
  fee_id uuid not null unique references public.visit_fees(id),
  waived_by uuid not null references public.profiles(id),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  waived_at timestamptz not null default now()
);

alter table public.pos_receipts
  add column if not exists fee_id uuid references public.visit_fees(id);

alter table public.pos_receipts
  drop constraint if exists pos_receipts_order_id_key;
alter table public.pos_receipts
  alter column order_id drop not null;
alter table public.pos_receipts
  add constraint pos_receipts_exactly_one_source check (
    (order_id is not null and fee_id is null)
    or (order_id is null and fee_id is not null)
  );
create unique index if not exists pos_receipts_order_unique
  on public.pos_receipts(order_id) where order_id is not null;

alter table public.pos_products enable row level security;
alter table public.pos_shifts enable row level security;
alter table public.pos_orders enable row level security;
alter table public.pos_order_items enable row level security;
alter table public.pos_receipts enable row level security;
alter table public.pos_receipt_voids enable row level security;
alter table public.visit_fees enable row level security;
alter table public.visit_fee_waivers enable row level security;

revoke all on public.pos_products, public.pos_shifts, public.pos_orders,
  public.pos_order_items, public.pos_receipts, public.pos_receipt_voids,
  public.visit_fees, public.visit_fee_waivers
  from public, anon, authenticated;

insert into public.permissions (key, description)
values
  ('orders.manage', 'Create and manage customer orders'),
  ('products.manage', 'Manage the point-of-sale product catalog and settings'),
  ('shifts.manage', 'Open and close point-of-sale shifts'),
  ('fees.manage', 'Waive customer visit fees'),
  ('discounts.apply', 'Apply discounts to customer orders'),
  ('receipts.void', 'Void issued receipts')
on conflict (key) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.name = 'Admin'
  and p.key in (
    'orders.manage', 'products.manage', 'shifts.manage',
    'fees.manage', 'discounts.apply', 'receipts.void'
  )
on conflict (role_id, permission_key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.name = 'Reception'
  and p.key in ('orders.manage', 'shifts.manage')
on conflict (role_id, permission_key) do nothing;

insert into public.settings (key, value)
values
  ('ops.currency', '"EGP"'::jsonb),
  ('ops.visit_duration_minutes', '180'::jsonb),
  ('ops.fee_interval_minutes', '30'::jsonb),
  ('ops.fee_amount', '10.00'::jsonb)
on conflict (key) do nothing;

drop policy if exists settings_ops_read on public.settings;
create policy settings_ops_read
  on public.settings
  for select
  to authenticated
  using (
    key like 'ops.%'
    and (
      public.has_permission('orders.manage')
      or public.has_permission('products.manage')
      or public.has_permission('shifts.manage')
      or public.has_permission('checkins.manage')
    )
  );

create or replace function public.get_pos_settings()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_currency text;
  v_duration integer;
  v_interval integer;
  v_fee numeric;
begin
  if not (
    coalesce(public.has_permission('orders.manage'), false)
    or coalesce(public.has_permission('products.manage'), false)
    or coalesce(public.has_permission('shifts.manage'), false)
    or coalesce(public.has_permission('checkins.manage'), false)
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select value #>> '{}' into v_currency from public.settings where key = 'ops.currency';
  select (value #>> '{}')::integer into v_duration from public.settings where key = 'ops.visit_duration_minutes';
  select (value #>> '{}')::integer into v_interval from public.settings where key = 'ops.fee_interval_minutes';
  select (value #>> '{}')::numeric into v_fee from public.settings where key = 'ops.fee_amount';

  return jsonb_build_object(
    'currency', coalesce(v_currency, 'EGP'),
    'visit_duration_minutes', coalesce(v_duration, 180),
    'fee_interval_minutes', coalesce(v_interval, 30),
    'fee_amount', coalesce(v_fee, 10.00),
    'server_now', now()
  );
end;
$$;

create or replace function public.update_pos_settings(
  p_currency text,
  p_visit_duration_minutes integer,
  p_fee_interval_minutes integer,
  p_fee_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_currency text;
begin
  if not coalesce(public.has_permission('products.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$'
     or p_visit_duration_minutes not between 1 and 1440
     or p_fee_interval_minutes not between 1 and 1440
     or p_fee_amount is null or p_fee_amount < 0 or p_fee_amount > 1000000 then
    raise exception using errcode = '22023', message = 'invalid point-of-sale settings';
  end if;

  select value #>> '{}' into v_currency
  from public.settings
  where key = 'ops.currency'
  for update;
  if exists (select 1 from public.pos_shifts where closed_at is null)
     and p_currency is distinct from coalesce(v_currency, 'EGP') then
    raise exception using errcode = '22023', message = 'currency cannot be changed while a shift is open';
  end if;

  insert into public.settings (key, value, updated_by, updated_at)
  values
    ('ops.currency', to_jsonb(p_currency), auth.uid(), now()),
    ('ops.visit_duration_minutes', to_jsonb(p_visit_duration_minutes), auth.uid(), now()),
    ('ops.fee_interval_minutes', to_jsonb(p_fee_interval_minutes), auth.uid(), now()),
    ('ops.fee_amount', to_jsonb(round(p_fee_amount, 2)), auth.uid(), now())
  on conflict (key) do update
  set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  insert into public.audit_logs (actor_id, action, entity, new_value)
  values (
    auth.uid(),
    'pos.settings.update',
    'pos_settings',
    jsonb_build_object(
      'currency', p_currency,
      'visit_duration_minutes', p_visit_duration_minutes,
      'fee_interval_minutes', p_fee_interval_minutes,
      'fee_amount', round(p_fee_amount, 2)
    )
  );

  return public.get_pos_settings();
end;
$$;

create or replace function public.list_pos_products()
returns setof jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
begin
  if not (
    coalesce(public.has_permission('orders.manage'), false)
    or coalesce(public.has_permission('products.manage'), false)
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  return query
  select jsonb_build_object(
    'id', p.id,
    'name_en', p.name_en,
    'name_ar', p.name_ar,
    'price', p.price,
    'qualifies_for_time', p.qualifies_for_time,
    'active', p.active,
    'created_at', p.created_at
  )
  from public.pos_products p
  order by p.active desc, p.name_en;
end;
$$;

create or replace function public.save_pos_product(
  p_id uuid,
  p_name_en text,
  p_name_ar text,
  p_price numeric,
  p_qualifies_for_time boolean,
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if not coalesce(public.has_permission('products.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_name_en is null or length(btrim(p_name_en)) not between 1 and 100
     or p_name_ar is null or length(btrim(p_name_ar)) not between 1 and 100
     or p_price is null or p_price < 0 or p_price > 1000000 then
    raise exception using errcode = '22023', message = 'invalid product';
  end if;

  if p_id is null then
    insert into public.pos_products (name_en, name_ar, price, qualifies_for_time, active)
    values (btrim(p_name_en), btrim(p_name_ar), round(p_price, 2), coalesce(p_qualifies_for_time, false), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.pos_products
    set name_en = btrim(p_name_en),
        name_ar = btrim(p_name_ar),
        price = round(p_price, 2),
        qualifies_for_time = coalesce(p_qualifies_for_time, false),
        active = coalesce(p_active, false),
        updated_at = now()
    where id = p_id
    returning id into v_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'product not found';
    end if;
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(),
    case when p_id is null then 'pos.product.create' else 'pos.product.update' end,
    'pos_product',
    v_id::text,
    jsonb_build_object(
      'name_en', btrim(p_name_en),
      'name_ar', btrim(p_name_ar),
      'price', round(p_price, 2),
      'qualifies_for_time', coalesce(p_qualifies_for_time, false),
      'active', coalesce(p_active, true)
    )
  );

  return v_id;
end;
$$;

create or replace function public.get_current_pos_shift()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_shift public.pos_shifts;
begin
  if not coalesce(public.has_permission('shifts.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select * into v_shift
  from public.pos_shifts
  where user_id = auth.uid() and closed_at is null
  limit 1;

  if not found then
    return jsonb_build_object('shift', null, 'server_now', now());
  end if;

  return jsonb_build_object(
    'shift', to_jsonb(v_shift),
    'server_now', now()
  );
end;
$$;

create or replace function public.open_pos_shift(p_opening_cash numeric)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_shift public.pos_shifts;
  v_currency text;
begin
  if not coalesce(public.has_permission('shifts.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_opening_cash is null or p_opening_cash < 0 or p_opening_cash > 100000000 then
    raise exception using errcode = '22023', message = 'invalid opening cash';
  end if;
  if exists (select 1 from public.pos_shifts where user_id = auth.uid() and closed_at is null) then
    raise exception using errcode = '23505', message = 'shift already open';
  end if;

  select value #>> '{}' into v_currency
  from public.settings
  where key = 'ops.currency'
  for share;
  insert into public.pos_shifts (user_id, opening_cash)
  values (auth.uid(), round(p_opening_cash, 2))
  returning * into v_shift;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'pos.shift.open', 'pos_shift', v_shift.id::text,
    jsonb_build_object('opening_cash', v_shift.opening_cash, 'currency', coalesce(v_currency, 'EGP'))
  );

  return jsonb_build_object('shift', to_jsonb(v_shift), 'currency', coalesce(v_currency, 'EGP'), 'server_now', now());
end;
$$;

create or replace function public.close_pos_shift(p_shift uuid, p_counted_cash numeric)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_shift public.pos_shifts;
  v_cash_sales numeric(12, 2);
  v_expected numeric(12, 2);
begin
  if not coalesce(public.has_permission('shifts.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_counted_cash is null or p_counted_cash < 0 or p_counted_cash > 100000000 then
    raise exception using errcode = '22023', message = 'invalid closing cash';
  end if;

  select * into v_shift
  from public.pos_shifts
  where id = p_shift and user_id = auth.uid() and closed_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'open shift not found';
  end if;

  select coalesce(sum(r.total), 0)::numeric(12, 2)
    into v_cash_sales
  from public.pos_receipts r
  where r.shift_id = v_shift.id
    and r.payment_method = 'cash'
    and not exists (
      select 1 from public.pos_receipt_voids x where x.receipt_id = r.id
    );

  v_expected := v_shift.opening_cash + v_cash_sales;
  update public.pos_shifts
  set closed_at = now(),
      counted_cash = round(p_counted_cash, 2),
      expected_cash = v_expected,
      variance = round(p_counted_cash, 2) - v_expected
  where id = v_shift.id
  returning * into v_shift;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'pos.shift.close', 'pos_shift', v_shift.id::text,
    jsonb_build_object(
      'counted_cash', v_shift.counted_cash,
      'expected_cash', v_shift.expected_cash,
      'variance', v_shift.variance
    )
  );

  return jsonb_build_object('shift', to_jsonb(v_shift), 'server_now', now());
end;
$$;

create or replace function public.list_open_pos_visits()
returns setof jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
begin
  if not (
    coalesce(public.has_permission('orders.manage'), false)
    or coalesce(public.has_permission('checkins.manage'), false)
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  return query
  select jsonb_build_object(
    'checkin_id', k.id,
    'customer_id', c.id,
    'customer_name', c.full_name,
    'customer_code', c.code,
    'checked_in_at', k.checked_in_at,
    'timer_started_at', k.timer_started_at,
    'last_qualifying_order_at', k.last_qualifying_order_at,
    'server_now', now(),
    'deadline', greatest(k.timer_started_at, coalesce(k.last_qualifying_order_at, k.timer_started_at))
      + make_interval(mins => coalesce((select (s.value #>> '{}')::integer from public.settings s where s.key = 'ops.visit_duration_minutes'), 180)),
    'resource_name', r.name
  )
  from public.checkins k
  join public.customers c on c.id = k.customer_id
  left join public.resources r on r.id = k.resource_id
  where k.checked_out_at is null
  order by k.checked_in_at;
end;
$$;

create or replace function public.create_pos_order(
  p_customer uuid,
  p_checkin bigint,
  p_items jsonb,
  p_discount_type text default null,
  p_discount_value numeric default 0,
  p_discount_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_shift public.pos_shifts;
  v_checkin public.checkins;
  v_item jsonb;
  v_product public.pos_products;
  v_quantity numeric(12, 3);
  v_subtotal numeric(12, 2) := 0;
  v_discount numeric(12, 2) := 0;
  v_total numeric(12, 2);
  v_currency text;
  v_order public.pos_orders;
  v_count integer := 0;
begin
  if not coalesce(public.has_permission('orders.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception using errcode = '22023', message = 'invalid order items';
  end if;

  select * into v_shift from public.pos_shifts
  where user_id = auth.uid() and closed_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'open shift required';
  end if;

  select * into v_checkin
  from public.checkins
  where id = p_checkin and customer_id = p_customer and checked_out_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'open customer visit not found';
  end if;

  select value #>> '{}' into v_currency from public.settings where key = 'ops.currency';
  if coalesce(p_discount_value, 0) > 0 then
    if not coalesce(public.has_permission('discounts.apply'), false) then
      raise exception using errcode = '42501', message = 'not allowed';
    end if;
    if p_discount_type is null
       or p_discount_type not in ('amount', 'percent')
       or p_discount_reason is null
       or length(btrim(p_discount_reason)) not between 3 and 500 then
      raise exception using errcode = '22023', message = 'discount reason required';
    end if;
    if p_discount_value < 0 or p_discount_value > 1000000
       or (p_discount_type = 'percent' and p_discount_value > 100) then
      raise exception using errcode = '22023', message = 'invalid discount';
    end if;
  end if;

  insert into public.pos_orders (
    customer_id, checkin_id, shift_id, created_by, currency,
    subtotal, discount_type, discount_value, discount_total, discount_reason, total
  )
  values (
    p_customer, p_checkin, v_shift.id, auth.uid(), coalesce(v_currency, 'EGP'),
    0, nullif(p_discount_type, ''), coalesce(p_discount_value, 0), 0,
    case when coalesce(p_discount_value, 0) > 0 then btrim(p_discount_reason) else null end, 0
  )
  returning * into v_order;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;
    if jsonb_typeof(v_item) is distinct from 'object'
       or nullif(v_item->>'product_id', '') is null
       or nullif(v_item->>'quantity', '') is null then
      raise exception using errcode = '22023', message = 'invalid order item';
    end if;

    begin
      v_quantity := (v_item->>'quantity')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'invalid order quantity';
    end;
    if v_quantity <= 0 or v_quantity > 99999 then
      raise exception using errcode = '22023', message = 'invalid order quantity';
    end if;

    select * into v_product
    from public.pos_products
    where id = (v_item->>'product_id')::uuid and active
    for share;
    if not found then
      raise exception using errcode = 'P0002', message = 'active product not found';
    end if;

    insert into public.pos_order_items (
      order_id, product_id, product_name_en, product_name_ar,
      unit_price, quantity, line_total, qualifies_for_time
    )
    values (
      v_order.id, v_product.id, v_product.name_en, v_product.name_ar,
      v_product.price, v_quantity, round(v_product.price * v_quantity, 2),
      v_product.qualifies_for_time
    );
    v_subtotal := v_subtotal + round(v_product.price * v_quantity, 2);
  end loop;

  v_subtotal := round(v_subtotal, 2);
  if coalesce(p_discount_value, 0) > 0 then
    v_discount := case p_discount_type
      when 'percent' then round(v_subtotal * p_discount_value / 100, 2)
      else round(p_discount_value, 2)
    end;
    v_discount := least(v_subtotal, v_discount);
  end if;
  v_total := greatest(0, v_subtotal - v_discount);

  update public.pos_orders
  set subtotal = v_subtotal, discount_total = v_discount, total = v_total
  where id = v_order.id
  returning * into v_order;

  if v_discount > 0 then
    insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
    values (
      auth.uid(), 'pos.order.discount', 'pos_order', v_order.id::text,
      jsonb_build_object(
        'discount_type', p_discount_type,
        'discount_value', p_discount_value,
        'discount_total', v_discount,
        'reason', btrim(p_discount_reason)
      )
    );
  end if;

  return jsonb_build_object(
    'order_id', v_order.id,
    'subtotal', v_order.subtotal,
    'discount_total', v_order.discount_total,
    'total', v_order.total,
    'currency', v_order.currency,
    'server_now', now()
  );
end;
$$;

create or replace function public.complete_pos_order(p_order uuid, p_payment_method text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.pos_orders;
  v_receipt public.pos_receipts;
  v_qualifies boolean;
begin
  if not coalesce(public.has_permission('orders.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_payment_method not in ('cash', 'card', 'other') then
    raise exception using errcode = '22023', message = 'invalid payment method';
  end if;

  select * into v_order
  from public.pos_orders
  where id = p_order and created_by = auth.uid() and status = 'open'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'open order not found';
  end if;
  if not exists (
    select 1 from public.pos_shifts
    where id = v_order.shift_id and user_id = auth.uid() and closed_at is null
  ) then
    raise exception using errcode = 'P0002', message = 'open shift required';
  end if;

  update public.pos_orders set status = 'paid', completed_at = now()
  where id = v_order.id
  returning * into v_order;

  insert into public.pos_receipts (
    receipt_no, order_id, shift_id, issued_by, payment_method, currency, total
  )
  values (
    'R-' || lpad(nextval('public.receipt_number_seq')::text, 8, '0'),
    v_order.id, v_order.shift_id, auth.uid(), p_payment_method, v_order.currency, v_order.total
  )
  returning * into v_receipt;

  select exists (
    select 1 from public.pos_order_items
    where order_id = v_order.id and qualifies_for_time
  ) into v_qualifies;
  if v_qualifies then
    update public.checkins
    set last_qualifying_order_at = now()
    where id = v_order.checkin_id and checked_out_at is null;
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'pos.order.complete', 'pos_order', v_order.id::text,
    jsonb_build_object(
      'receipt_id', v_receipt.id,
      'receipt_no', v_receipt.receipt_no,
      'total', v_receipt.total,
      'currency', v_receipt.currency,
      'payment_method', v_receipt.payment_method
    )
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'receipt_id', v_receipt.id,
    'receipt_no', v_receipt.receipt_no,
    'total', v_receipt.total,
    'currency', v_receipt.currency,
    'payment_method', v_receipt.payment_method,
    'qualifies_for_time', v_qualifies,
    'server_now', now()
  );
end;
$$;

create or replace function public.cancel_pos_order(p_order uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.pos_orders;
begin
  if not coalesce(public.has_permission('orders.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'cancellation reason required';
  end if;

  select * into v_order
  from public.pos_orders
  where id = p_order and created_by = auth.uid() and status = 'open'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'open order not found';
  end if;

  update public.pos_orders set status = 'cancelled', cancelled_at = now()
  where id = v_order.id;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'pos.order.cancel', 'pos_order', v_order.id::text,
    jsonb_build_object('reason', btrim(p_reason))
  );
end;
$$;

create or replace function public.void_pos_receipt(p_receipt uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_receipt public.pos_receipts;
begin
  if not coalesce(public.has_permission('receipts.void'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'void reason required';
  end if;

  select * into v_receipt
  from public.pos_receipts
  where id = p_receipt
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'receipt not found';
  end if;
  if exists (select 1 from public.pos_receipt_voids where receipt_id = p_receipt) then
    raise exception using errcode = '23505', message = 'receipt already voided';
  end if;

  insert into public.pos_receipt_voids (receipt_id, voided_by, reason)
  values (p_receipt, auth.uid(), btrim(p_reason));
  update public.pos_orders set status = 'voided' where id = v_receipt.order_id;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'pos.receipt.void', 'pos_receipt', v_receipt.id::text,
    jsonb_build_object(
      'receipt_no', v_receipt.receipt_no,
      'amount', v_receipt.total,
      'currency', v_receipt.currency,
      'reason', btrim(p_reason)
    )
  );
end;
$$;

create or replace function public.waive_visit_fee(p_fee uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not coalesce(public.has_permission('fees.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'waiver reason required';
  end if;
  if not exists (
    select 1 from public.visit_fees f
    where f.id = p_fee
      and not exists (select 1 from public.visit_fee_waivers w where w.fee_id = f.id)
      and not exists (
        select 1 from public.pos_receipts r
        where r.fee_id = f.id
          and not exists (select 1 from public.pos_receipt_voids v where v.receipt_id = r.id)
      )
  ) then
    raise exception using errcode = 'P0002', message = 'unpaid active fee not found';
  end if;

  insert into public.visit_fee_waivers (fee_id, waived_by, reason)
  values (p_fee, auth.uid(), btrim(p_reason));
  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'pos.fee.waive', 'visit_fee', p_fee::text,
    jsonb_build_object('reason', btrim(p_reason))
  );
end;
$$;

create or replace function public.pay_visit_fee(p_fee uuid, p_payment_method text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_fee public.visit_fees;
  v_shift public.pos_shifts;
  v_receipt public.pos_receipts;
begin
  if not coalesce(public.has_permission('orders.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_payment_method not in ('cash', 'card', 'other') then
    raise exception using errcode = '22023', message = 'invalid payment method';
  end if;

  select * into v_fee from public.visit_fees where id = p_fee for update;
  if not found
     or exists (select 1 from public.visit_fee_waivers where fee_id = p_fee)
     or exists (
       select 1 from public.pos_receipts r
       where r.fee_id = p_fee
         and not exists (select 1 from public.pos_receipt_voids v where v.receipt_id = r.id)
     ) then
    raise exception using errcode = 'P0002', message = 'unpaid active fee not found';
  end if;

  select * into v_shift from public.pos_shifts
  where user_id = auth.uid() and closed_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'open shift required';
  end if;

  insert into public.pos_receipts (
    receipt_no, fee_id, shift_id, issued_by, payment_method, currency, total
  )
  values (
    'R-' || lpad(nextval('public.receipt_number_seq')::text, 8, '0'),
    v_fee.id, v_shift.id, auth.uid(), p_payment_method, v_fee.currency, v_fee.amount
  )
  returning * into v_receipt;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'pos.fee.pay', 'visit_fee', v_fee.id::text,
    jsonb_build_object(
      'receipt_no', v_receipt.receipt_no,
      'amount', v_receipt.total,
      'currency', v_receipt.currency,
      'payment_method', p_payment_method
    )
  );

  return jsonb_build_object(
    'receipt_no', v_receipt.receipt_no,
    'total', v_receipt.total,
    'currency', v_receipt.currency,
    'payment_method', v_receipt.payment_method,
    'server_now', now()
  );
end;
$$;

create or replace function public.list_pos_receipts()
returns setof jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
begin
  if not (
    coalesce(public.has_permission('orders.manage'), false)
    or coalesce(public.has_permission('receipts.void'), false)
    or coalesce(public.has_permission('shifts.manage'), false)
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  return query
  select jsonb_build_object(
    'id', r.id,
    'receipt_no', r.receipt_no,
    'issued_at', r.issued_at,
    'total', r.total,
    'currency', r.currency,
    'payment_method', r.payment_method,
    'voided', exists (select 1 from public.pos_receipt_voids v where v.receipt_id = r.id),
    'void_reason', (select v.reason from public.pos_receipt_voids v where v.receipt_id = r.id),
    'customer_name', coalesce(c.full_name, c2.full_name),
    'customer_code', coalesce(c.code, c2.code)
  )
  from public.pos_receipts r
  left join public.pos_orders o on o.id = r.order_id
  left join public.customers c on c.id = o.customer_id
  left join public.visit_fees f on f.id = r.fee_id
  left join public.checkins k on k.id = f.checkin_id
  left join public.customers c2 on c2.id = k.customer_id
  order by r.issued_at desc
  limit 200;
end;
$$;

create or replace function public.list_open_pos_orders()
returns setof jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
begin
  if not coalesce(public.has_permission('orders.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  return query
  select jsonb_build_object(
    'id', o.id,
    'customer_id', o.customer_id,
    'checkin_id', o.checkin_id,
    'customer_name', c.full_name,
    'customer_code', c.code,
    'created_at', o.created_at,
    'subtotal', o.subtotal,
    'discount_total', o.discount_total,
    'total', o.total,
    'currency', o.currency,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name_en', i.product_name_en,
        'name_ar', i.product_name_ar,
        'quantity', i.quantity,
        'line_total', i.line_total
      ) order by i.id)
      from public.pos_order_items i where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.pos_orders o
  join public.customers c on c.id = o.customer_id
  where o.status = 'open' and o.created_by = auth.uid()
  order by o.created_at desc
  limit 100;
end;
$$;

create or replace function public.list_visit_fees()
returns setof jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
begin
  if not (
    coalesce(public.has_permission('orders.manage'), false)
    or coalesce(public.has_permission('fees.manage'), false)
    or coalesce(public.has_permission('checkins.manage'), false)
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  return query
  select jsonb_build_object(
    'id', f.id,
    'checkin_id', f.checkin_id,
    'amount', f.amount,
    'currency', f.currency,
    'created_at', f.created_at,
    'customer_name', c.full_name,
    'customer_code', c.code,
    'waived', exists (select 1 from public.visit_fee_waivers w where w.fee_id = f.id),
    'paid', exists (
      select 1 from public.pos_receipts r
      where r.fee_id = f.id
        and not exists (select 1 from public.pos_receipt_voids v where v.receipt_id = r.id)
    )
  )
  from public.visit_fees f
  join public.checkins k on k.id = f.checkin_id
  join public.customers c on c.id = k.customer_id
  order by f.created_at desc
  limit 200;
end;
$$;

drop function if exists public.check_out(bigint);
create function public.check_out(p_checkin bigint)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_checkin public.checkins;
  v_shift public.pos_shifts;
  v_currency text;
  v_fee_amount numeric(12, 2);
  v_interval integer;
  v_duration integer;
  v_deadline timestamptz;
  v_elapsed_intervals bigint;
  v_fee numeric(12, 2) := 0;
  v_fee_row public.visit_fees;
begin
  if not coalesce(public.has_permission('checkins.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select * into v_checkin
  from public.checkins
  where id = p_checkin and checked_out_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'visit not found or already closed';
  end if;

  if exists (select 1 from public.visit_fees where checkin_id = v_checkin.id) then
    raise exception using errcode = '23505', message = 'visit fee already calculated';
  end if;

  select * into v_shift
  from public.pos_shifts
  where user_id = auth.uid() and closed_at is null
  limit 1
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'open shift required';
  end if;

  select value #>> '{}' into v_currency from public.settings where key = 'ops.currency';
  select (value #>> '{}')::numeric into v_fee_amount from public.settings where key = 'ops.fee_amount';
  select (value #>> '{}')::integer into v_interval from public.settings where key = 'ops.fee_interval_minutes';
  select (value #>> '{}')::integer into v_duration from public.settings where key = 'ops.visit_duration_minutes';

  v_deadline := greatest(
    v_checkin.timer_started_at,
    coalesce(v_checkin.last_qualifying_order_at, v_checkin.timer_started_at)
  ) + make_interval(mins => coalesce(v_duration, 180));

  if now() > v_deadline and coalesce(v_fee_amount, 0) > 0 then
    v_elapsed_intervals := ceil(extract(epoch from (now() - v_deadline)) / (coalesce(v_interval, 30) * 60));
    v_fee := round(v_elapsed_intervals * v_fee_amount, 2);
    insert into public.visit_fees (checkin_id, shift_id, currency, amount)
    values (v_checkin.id, v_shift.id, coalesce(v_currency, 'EGP'), v_fee)
    returning * into v_fee_row;
  end if;

  update public.checkins
  set checked_out_at = now(), closed_by = auth.uid()
  where id = v_checkin.id;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'checkin.checkout', 'checkin', v_checkin.id::text,
    jsonb_build_object('fees_due', v_fee, 'currency', coalesce(v_currency, 'EGP'))
  );

  return jsonb_build_object(
    'checkin_id', v_checkin.id,
    'checked_out_at', now(),
    'fees_due', v_fee,
    'fee_id', v_fee_row.id,
    'currency', coalesce(v_currency, 'EGP'),
    'server_now', now()
  );
end;
$$;

create or replace function public.scan_customer(p_input text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  c public.customers;
  v_input text := btrim(coalesce(p_input, ''));
  v_result text;
  v_checkin public.checkins;
  v_duration integer;
  v_deadline timestamptz;
begin
  if not coalesce(public.has_permission('scanner.use'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if length(v_input) > 512 then v_input := ''; end if;

  select * into c
  from public.customers
  where deleted_at is null
    and (qr_token = v_input or upper(code) = upper(v_input))
  limit 1;

  if not found then
    insert into public.scan_logs (user_id, result) values (auth.uid(), 'unknown');
    return jsonb_build_object('ok', false, 'reason', 'unknown', 'server_now', now());
  end if;

  v_result := case
    when c.status = 'blocked' then 'blocked'
    when c.status = 'expired'
      or (c.expiry_date is not null and c.expiry_date < current_date)
      then 'expired'
    else 'ok'
  end;
  insert into public.scan_logs (user_id, customer_id, result)
  values (auth.uid(), c.id, v_result);

  select * into v_checkin
  from public.checkins
  where customer_id = c.id and checked_out_at is null
  order by checked_in_at desc
  limit 1;

  select (value #>> '{}')::integer into v_duration
  from public.settings where key = 'ops.visit_duration_minutes';

  if v_checkin.id is not null then
    v_deadline := greatest(
      v_checkin.timer_started_at,
      coalesce(v_checkin.last_qualifying_order_at, v_checkin.timer_started_at)
    ) + make_interval(mins => coalesce(v_duration, 180));
  end if;

  return jsonb_build_object(
    'ok', v_result = 'ok',
    'reason', v_result,
    'customer', jsonb_build_object(
      'id', c.id,
      'code', c.code,
      'first_name', c.first_name,
      'last_name', c.last_name,
      'birth_date', c.birth_date
    ),
    'checkin', case when v_checkin.id is not null then to_jsonb(v_checkin) else null end,
    'deadline', v_deadline,
    'server_now', now()
  );
end;
$$;

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
begin
  if not coalesce(public.has_permission('checkins.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select * into v_checkin
  from public.checkins
  where id = p_checkin and checked_out_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'open visit not found';
  end if;

  select (value #>> '{}')::integer into v_duration
  from public.settings where key = 'ops.visit_duration_minutes';

  return jsonb_build_object(
    'deadline',
    greatest(
      v_checkin.timer_started_at,
      coalesce(v_checkin.last_qualifying_order_at, v_checkin.timer_started_at)
    ) + make_interval(mins => coalesce(v_duration, 180)),
    'server_now', now()
  );
end;
$$;

revoke all on function public.get_pos_settings() from public, anon;
revoke all on function public.update_pos_settings(text, integer, integer, numeric) from public, anon;
revoke all on function public.list_pos_products() from public, anon;
revoke all on function public.save_pos_product(uuid, text, text, numeric, boolean, boolean) from public, anon;
revoke all on function public.get_current_pos_shift() from public, anon;
revoke all on function public.open_pos_shift(numeric) from public, anon;
revoke all on function public.close_pos_shift(uuid, numeric) from public, anon;
revoke all on function public.list_open_pos_visits() from public, anon;
revoke all on function public.list_open_pos_orders() from public, anon;
revoke all on function public.create_pos_order(uuid, bigint, jsonb, text, numeric, text) from public, anon;
revoke all on function public.complete_pos_order(uuid, text) from public, anon;
revoke all on function public.cancel_pos_order(uuid, text) from public, anon;
revoke all on function public.void_pos_receipt(uuid, text) from public, anon;
revoke all on function public.list_pos_receipts() from public, anon;
revoke all on function public.list_visit_fees() from public, anon;
revoke all on function public.get_visit_timer(bigint) from public, anon;
revoke all on function public.waive_visit_fee(uuid, text) from public, anon;
revoke all on function public.pay_visit_fee(uuid, text) from public, anon;
revoke all on function public.check_out(bigint) from public, anon;

grant execute on function public.get_pos_settings() to authenticated;
grant execute on function public.update_pos_settings(text, integer, integer, numeric) to authenticated;
grant execute on function public.list_pos_products() to authenticated;
grant execute on function public.save_pos_product(uuid, text, text, numeric, boolean, boolean) to authenticated;
grant execute on function public.get_current_pos_shift() to authenticated;
grant execute on function public.open_pos_shift(numeric) to authenticated;
grant execute on function public.close_pos_shift(uuid, numeric) to authenticated;
grant execute on function public.list_open_pos_visits() to authenticated;
grant execute on function public.list_open_pos_orders() to authenticated;
grant execute on function public.create_pos_order(uuid, bigint, jsonb, text, numeric, text) to authenticated;
grant execute on function public.complete_pos_order(uuid, text) to authenticated;
grant execute on function public.cancel_pos_order(uuid, text) to authenticated;
grant execute on function public.void_pos_receipt(uuid, text) to authenticated;
grant execute on function public.list_pos_receipts() to authenticated;
grant execute on function public.list_visit_fees() to authenticated;
grant execute on function public.get_visit_timer(bigint) to authenticated;
grant execute on function public.waive_visit_fee(uuid, text) to authenticated;
grant execute on function public.pay_visit_fee(uuid, text) to authenticated;
grant execute on function public.check_out(bigint) to authenticated;

commit;
