begin;

create table if not exists public.pos_menu_categories (
  id uuid primary key default gen_random_uuid(),
  name_en text not null,
  name_ar text not null,
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_menu_categories_name_en_length check (length(btrim(name_en)) between 1 and 80),
  constraint pos_menu_categories_name_ar_length check (length(btrim(name_ar)) between 1 and 80)
);

alter table public.pos_products
  add column if not exists category_id uuid references public.pos_menu_categories(id),
  add column if not exists description text,
  add column if not exists available boolean not null default true,
  add column if not exists image_path text,
  add column if not exists sort integer not null default 0;

alter table public.pos_orders
  add column if not exists order_number bigint,
  add column if not exists service_amount numeric(12, 2) not null default 0,
  add column if not exists tax_amount numeric(12, 2) not null default 0,
  add column if not exists status_updated_at timestamptz not null default now();

create sequence if not exists public.pos_order_number_seq;
alter table public.pos_orders
  alter column order_number set default nextval('public.pos_order_number_seq');
update public.pos_orders
set order_number = nextval('public.pos_order_number_seq')
where order_number is null;
alter table public.pos_orders alter column order_number set not null;
create unique index if not exists pos_orders_order_number_unique
  on public.pos_orders(order_number);

alter table public.pos_orders
  drop constraint if exists pos_orders_status_check;
alter table public.pos_orders
  add constraint pos_orders_status_check
  check (status in ('open', 'new', 'preparing', 'ready', 'served', 'paid', 'cancelled', 'voided'));

alter table public.pos_products enable row level security;
alter table public.pos_menu_categories enable row level security;
revoke all on public.pos_menu_categories from public, anon, authenticated;

insert into public.permissions (key, description)
values
  ('menu.manage', 'Manage menu categories, items, availability and images'),
  ('orders.create', 'Create customer orders'),
  ('orders.view', 'View active customer orders'),
  ('orders.update_status', 'Move customer orders through preparation'),
  ('orders.cancel', 'Cancel orders with a reason')
on conflict (key) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.name = 'Admin'
  and p.key in ('menu.manage', 'orders.view', 'orders.update_status', 'orders.cancel')
on conflict (role_id, permission_key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.name = 'Reception'
  and p.key in ('orders.create', 'orders.view', 'orders.update_status', 'orders.cancel')
on conflict (role_id, permission_key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.name = 'Barista'
  and p.key in ('orders.view', 'orders.update_status')
on conflict (role_id, permission_key) do nothing;

drop policy if exists pos_menu_categories_read on public.pos_menu_categories;
create policy pos_menu_categories_read
  on public.pos_menu_categories for select to authenticated
  using (
    coalesce(public.has_permission('orders.manage'), false)
    or coalesce(public.has_permission('orders.view'), false)
    or coalesce(public.has_permission('orders.create'), false)
    or coalesce(public.has_permission('menu.manage'), false)
    or coalesce(public.has_permission('products.manage'), false)
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu', 'menu', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists menu_images_public_read on storage.objects;
create policy menu_images_public_read
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'menu');

drop policy if exists menu_images_write on storage.objects;
create policy menu_images_write
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'menu'
    and name like 'items/%'
    and coalesce(public.has_permission('menu.manage'), false)
  );

drop policy if exists menu_images_update on storage.objects;
create policy menu_images_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'menu' and name like 'items/%'
    and coalesce(public.has_permission('menu.manage'), false)
  )
  with check (
    bucket_id = 'menu' and name like 'items/%'
    and coalesce(public.has_permission('menu.manage'), false)
  );

drop policy if exists menu_images_delete on storage.objects;
create policy menu_images_delete
  on storage.objects for delete to authenticated
  using (bucket_id = 'menu' and coalesce(public.has_permission('menu.manage'), false));

insert into public.settings (key, value)
values
  ('ops.timezone', '"Africa/Cairo"'::jsonb),
  ('ops.tax_percent', '0'::jsonb),
  ('ops.service_percent', '0'::jsonb),
  ('ops.timer_warning_minutes', '15'::jsonb),
  ('ops.timer_grace_minutes', '0'::jsonb),
  ('ops.fee_repeats', 'true'::jsonb),
  ('ops.timer_reset_on', '"order_paid"'::jsonb),
  ('ops.require_open_shift', 'false'::jsonb),
  ('ops.receipt_prefix', '"R-"'::jsonb),
  ('ops.cash_diff_alert', '50'::jsonb)
on conflict (key) do nothing;

create or replace function public.get_pos_settings()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if not (
    coalesce(public.has_permission('orders.manage'), false)
    or coalesce(public.has_permission('orders.view'), false)
    or coalesce(public.has_permission('products.manage'), false)
    or coalesce(public.has_permission('shifts.manage'), false)
    or coalesce(public.has_permission('checkins.manage'), false)
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select jsonb_build_object(
    'currency', coalesce((select value #>> '{}' from public.settings where key = 'ops.currency'), 'EGP'),
    'visit_duration_minutes', coalesce((select (value #>> '{}')::integer from public.settings where key = 'ops.visit_duration_minutes'), 180),
    'fee_interval_minutes', coalesce((select (value #>> '{}')::integer from public.settings where key = 'ops.fee_interval_minutes'), 30),
    'fee_amount', coalesce((select (value #>> '{}')::numeric from public.settings where key = 'ops.fee_amount'), 10.00),
    'timezone', coalesce((select value #>> '{}' from public.settings where key = 'ops.timezone'), 'Africa/Cairo'),
    'tax_percent', coalesce((select (value #>> '{}')::numeric from public.settings where key = 'ops.tax_percent'), 0),
    'service_percent', coalesce((select (value #>> '{}')::numeric from public.settings where key = 'ops.service_percent'), 0),
    'timer_warning_minutes', coalesce((select (value #>> '{}')::integer from public.settings where key = 'ops.timer_warning_minutes'), 15),
    'timer_grace_minutes', coalesce((select (value #>> '{}')::integer from public.settings where key = 'ops.timer_grace_minutes'), 0),
    'fee_repeats', coalesce((select (value #>> '{}')::boolean from public.settings where key = 'ops.fee_repeats'), true),
    'timer_reset_on', coalesce((select value #>> '{}' from public.settings where key = 'ops.timer_reset_on'), 'order_paid'),
    'require_open_shift', coalesce((select (value #>> '{}')::boolean from public.settings where key = 'ops.require_open_shift'), false),
    'receipt_prefix', coalesce((select value #>> '{}' from public.settings where key = 'ops.receipt_prefix'), 'R-'),
    'cash_diff_alert', coalesce((select (value #>> '{}')::numeric from public.settings where key = 'ops.cash_diff_alert'), 50),
    'server_now', now()
  ) into v_result;
  return v_result;
end;
$$;

drop function if exists public.update_pos_settings(text, integer, integer, numeric);
create function public.update_pos_settings(
  p_currency text,
  p_visit_duration_minutes integer,
  p_fee_interval_minutes integer,
  p_fee_amount numeric,
  p_timezone text,
  p_tax_percent numeric,
  p_service_percent numeric,
  p_timer_warning_minutes integer,
  p_timer_grace_minutes integer,
  p_fee_repeats boolean,
  p_timer_reset_on text,
  p_require_open_shift boolean,
  p_receipt_prefix text,
  p_cash_diff_alert numeric
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
     or p_fee_amount is null or p_fee_amount not between 0 and 1000000
     or p_tax_percent is null or p_tax_percent not between 0 and 100
     or p_service_percent is null or p_service_percent not between 0 and 100
     or p_timer_warning_minutes is null or p_timer_warning_minutes not between 0 and 1440
     or p_timer_grace_minutes is null or p_timer_grace_minutes not between 0 and 1440
     or p_fee_repeats is null or p_timer_reset_on is null
     or p_timer_reset_on not in ('order_created', 'order_paid')
     or p_require_open_shift is null
     or p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone)
     or p_receipt_prefix is null or p_receipt_prefix !~ '^[A-Za-z0-9-]{1,10}$'
     or p_cash_diff_alert is null or p_cash_diff_alert not between 0 and 100000000 then
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
    ('ops.fee_amount', to_jsonb(round(p_fee_amount, 2)), auth.uid(), now()),
    ('ops.timezone', to_jsonb(p_timezone), auth.uid(), now()),
    ('ops.tax_percent', to_jsonb(round(p_tax_percent, 2)), auth.uid(), now()),
    ('ops.service_percent', to_jsonb(round(p_service_percent, 2)), auth.uid(), now()),
    ('ops.timer_warning_minutes', to_jsonb(p_timer_warning_minutes), auth.uid(), now()),
    ('ops.timer_grace_minutes', to_jsonb(p_timer_grace_minutes), auth.uid(), now()),
    ('ops.fee_repeats', to_jsonb(p_fee_repeats), auth.uid(), now()),
    ('ops.timer_reset_on', to_jsonb(p_timer_reset_on), auth.uid(), now()),
    ('ops.require_open_shift', to_jsonb(p_require_open_shift), auth.uid(), now()),
    ('ops.receipt_prefix', to_jsonb(p_receipt_prefix), auth.uid(), now()),
    ('ops.cash_diff_alert', to_jsonb(round(p_cash_diff_alert, 2)), auth.uid(), now())
  on conflict (key) do update
  set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  insert into public.audit_logs (actor_id, action, entity, new_value)
  values (
    auth.uid(), 'pos.settings.update', 'pos_settings',
    jsonb_build_object(
      'currency', p_currency, 'tax_percent', p_tax_percent,
      'service_percent', p_service_percent, 'timezone', p_timezone,
      'timer_reset_on', p_timer_reset_on, 'require_open_shift', p_require_open_shift
    )
  );
  return public.get_pos_settings();
end;
$$;

create or replace function public.list_pos_categories()
returns setof jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
begin
  if not (
    coalesce(public.has_permission('orders.manage'), false)
    or coalesce(public.has_permission('orders.view'), false)
    or coalesce(public.has_permission('orders.create'), false)
    or coalesce(public.has_permission('menu.manage'), false)
    or coalesce(public.has_permission('products.manage'), false)
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  return query
  select jsonb_build_object('id', c.id, 'name_en', c.name_en, 'name_ar', c.name_ar, 'sort', c.sort, 'active', c.active)
  from public.pos_menu_categories c
  where c.active or coalesce(public.has_permission('menu.manage'), false)
      or coalesce(public.has_permission('products.manage'), false)
  order by c.sort, c.name_en;
end;
$$;

create or replace function public.save_pos_category(
  p_id uuid, p_name_en text, p_name_ar text, p_sort integer, p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if not coalesce(public.has_permission('menu.manage'), false)
     and not coalesce(public.has_permission('products.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_name_en is null or length(btrim(p_name_en)) not between 1 and 80
     or p_name_ar is null or length(btrim(p_name_ar)) not between 1 and 80
     or p_sort is null or p_sort not between -100000 and 100000
     or p_active is null then
    raise exception using errcode = '22023', message = 'invalid menu category';
  end if;

  if p_id is null then
    insert into public.pos_menu_categories (name_en, name_ar, sort, active)
    values (btrim(p_name_en), btrim(p_name_ar), p_sort, p_active)
    returning id into v_id;
  else
    update public.pos_menu_categories
    set name_en = btrim(p_name_en), name_ar = btrim(p_name_ar),
        sort = p_sort, active = p_active, updated_at = now()
    where id = p_id returning id into v_id;
    if not found then raise exception using errcode = 'P0002', message = 'category not found'; end if;
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), case when p_id is null then 'pos.category.create' else 'pos.category.update' end,
    'pos_menu_category', v_id::text,
    jsonb_build_object('name_en', btrim(p_name_en), 'name_ar', btrim(p_name_ar), 'active', p_active)
  );
  return v_id;
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
    or coalesce(public.has_permission('orders.view'), false)
    or coalesce(public.has_permission('orders.create'), false)
    or coalesce(public.has_permission('products.manage'), false)
    or coalesce(public.has_permission('menu.manage'), false)
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  return query
  select jsonb_build_object(
    'id', p.id, 'category_id', p.category_id, 'category_name_en', c.name_en,
    'category_name_ar', c.name_ar, 'name_en', p.name_en, 'name_ar', p.name_ar,
    'description', p.description, 'price', p.price,
    'qualifies_for_time', p.qualifies_for_time, 'active', p.active,
    'available', p.available, 'image_path', p.image_path, 'sort', p.sort,
    'created_at', p.created_at
  )
  from public.pos_products p
  left join public.pos_menu_categories c on c.id = p.category_id
  where (p.active and p.available)
     or coalesce(public.has_permission('products.manage'), false)
     or coalesce(public.has_permission('menu.manage'), false)
  order by c.sort nulls last, p.sort, p.name_en;
end;
$$;

create or replace function public.save_pos_menu_item(
  p_id uuid,
  p_category_id uuid,
  p_name_en text,
  p_name_ar text,
  p_description text,
  p_price numeric,
  p_counts_for_minimum boolean,
  p_available boolean,
  p_active boolean,
  p_image_path text,
  p_sort integer
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if not coalesce(public.has_permission('menu.manage'), false)
     and not coalesce(public.has_permission('products.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_category_id is null
     or not exists (select 1 from public.pos_menu_categories where id = p_category_id)
     or p_name_en is null or length(btrim(p_name_en)) not between 1 and 100
     or p_name_ar is null or length(btrim(p_name_ar)) not between 1 and 100
     or length(coalesce(p_description, '')) > 500
     or p_price is null or p_price not between 0 and 1000000
     or p_counts_for_minimum is null or p_available is null or p_active is null
     or p_sort is null or p_sort not between -100000 and 100000
     or (p_image_path is not null and (length(p_image_path) > 200 or p_image_path !~ '^items/[A-Za-z0-9-]+[.](jpg|jpeg|png|webp)$')) then
    raise exception using errcode = '22023', message = 'invalid menu item';
  end if;

  if p_id is null then
    insert into public.pos_products (
      category_id, name_en, name_ar, description, price, qualifies_for_time,
      available, active, image_path, sort
    )
    values (
      p_category_id, btrim(p_name_en), btrim(p_name_ar), nullif(btrim(p_description), ''),
      round(p_price, 2), p_counts_for_minimum, p_available, p_active, p_image_path, p_sort
    ) returning id into v_id;
  else
    update public.pos_products
    set category_id = p_category_id, name_en = btrim(p_name_en), name_ar = btrim(p_name_ar),
        description = nullif(btrim(p_description), ''), price = round(p_price, 2),
        qualifies_for_time = p_counts_for_minimum, available = p_available,
        active = p_active, image_path = p_image_path, sort = p_sort, updated_at = now()
    where id = p_id returning id into v_id;
    if not found then raise exception using errcode = 'P0002', message = 'menu item not found'; end if;
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), case when p_id is null then 'pos.menu_item.create' else 'pos.menu_item.update' end,
    'pos_product', v_id::text,
    jsonb_build_object(
      'category_id', p_category_id, 'name_en', btrim(p_name_en),
      'name_ar', btrim(p_name_ar), 'price', round(p_price, 2),
      'available', p_available, 'active', p_active,
      'counts_for_minimum', p_counts_for_minimum
    )
  );
  return v_id;
end;
$$;

alter table public.pos_orders alter column shift_id drop not null;
alter table public.pos_receipts alter column shift_id drop not null;
alter table public.visit_fees alter column shift_id drop not null;

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
  v_service numeric(12, 2) := 0;
  v_tax numeric(12, 2) := 0;
  v_total numeric(12, 2);
  v_currency text;
  v_timer_reset_on text;
  v_order public.pos_orders;
  v_count integer := 0;
begin
  if not coalesce(public.has_permission('orders.manage'), false)
     and not coalesce(public.has_permission('orders.create'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception using errcode = '22023', message = 'invalid order items';
  end if;

  select * into v_shift from public.pos_shifts
  where user_id = auth.uid() and closed_at is null
  for update;
  if not found and coalesce((select (value #>> '{}')::boolean from public.settings where key = 'ops.require_open_shift'), false) then
    raise exception using errcode = 'P0002', message = 'open shift required';
  end if;

  select * into v_checkin
  from public.checkins
  where id = p_checkin and customer_id = p_customer and checked_out_at is null
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'open customer visit not found'; end if;

  select value #>> '{}' into v_currency from public.settings where key = 'ops.currency';
  select value #>> '{}' into v_timer_reset_on from public.settings where key = 'ops.timer_reset_on';
  if coalesce(p_discount_value, 0) > 0 then
    if not coalesce(public.has_permission('discounts.apply'), false) then
      raise exception using errcode = '42501', message = 'not allowed';
    end if;
    if p_discount_type is null or p_discount_type not in ('amount', 'percent')
       or p_discount_reason is null or length(btrim(p_discount_reason)) not between 3 and 500
       or p_discount_value < 0 or p_discount_value > 1000000
       or (p_discount_type = 'percent' and p_discount_value > 100) then
      raise exception using errcode = '22023', message = 'invalid discount';
    end if;
  end if;

  insert into public.pos_orders (
    customer_id, checkin_id, shift_id, created_by, currency, status,
    subtotal, discount_type, discount_value, discount_total, discount_reason, total
  )
  values (
    p_customer, p_checkin, v_shift.id, auth.uid(), coalesce(v_currency, 'EGP'), 'new',
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
    if v_quantity < 1 or v_quantity > 50 or v_quantity <> trunc(v_quantity) then
      raise exception using errcode = '22023', message = 'invalid order quantity';
    end if;

    select * into v_product
    from public.pos_products
    where id = (v_item->>'product_id')::uuid and active and available
    for share;
    if not found or (v_product.category_id is not null and not exists (
      select 1 from public.pos_menu_categories where id = v_product.category_id and active
    )) then
      raise exception using errcode = 'P0002', message = 'active menu item not found';
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
  v_service := round((v_subtotal - v_discount) * coalesce((select (value #>> '{}')::numeric from public.settings where key = 'ops.service_percent'), 0) / 100, 2);
  v_tax := round((v_subtotal - v_discount + v_service) * coalesce((select (value #>> '{}')::numeric from public.settings where key = 'ops.tax_percent'), 0) / 100, 2);
  v_total := greatest(0, v_subtotal - v_discount + v_service + v_tax);

  update public.pos_orders
  set subtotal = v_subtotal, discount_total = v_discount,
      service_amount = v_service, tax_amount = v_tax, total = v_total
  where id = v_order.id
  returning * into v_order;

  if exists (select 1 from public.pos_order_items where order_id = v_order.id and qualifies_for_time)
     and coalesce(v_timer_reset_on, 'order_paid') = 'order_created' then
    update public.checkins set last_qualifying_order_at = now() where id = v_checkin.id;
  end if;

  if v_discount > 0 then
    insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
    values (
      auth.uid(), 'pos.order.discount', 'pos_order', v_order.id::text,
      jsonb_build_object(
        'discount_type', p_discount_type, 'discount_value', p_discount_value,
        'discount_total', v_discount, 'reason', btrim(p_discount_reason)
      )
    );
  end if;

  return jsonb_build_object(
    'order_id', v_order.id, 'order_number', v_order.order_number,
    'subtotal', v_order.subtotal, 'discount_total', v_order.discount_total,
    'service_amount', v_order.service_amount, 'tax_amount', v_order.tax_amount,
    'total', v_order.total, 'currency', v_order.currency, 'server_now', now()
  );
end;
$$;

create or replace function public.set_pos_order_status(p_order uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.pos_orders;
  v_next text;
begin
  if not coalesce(public.has_permission('orders.manage'), false)
     and not coalesce(public.has_permission('orders.update_status'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_status is null or p_status not in ('preparing', 'ready', 'served') then
    raise exception using errcode = '22023', message = 'invalid order status';
  end if;

  select * into v_order from public.pos_orders where id = p_order for update;
  if not found or v_order.status in ('paid', 'cancelled', 'voided') then
    raise exception using errcode = 'P0002', message = 'active order not found';
  end if;
  v_next := case v_order.status
    when 'new' then 'preparing'
    when 'preparing' then 'ready'
    when 'ready' then 'served'
    else null
  end;
  if v_next is distinct from p_status then
    raise exception using errcode = '22023', message = 'invalid order status transition';
  end if;

  update public.pos_orders
  set status = p_status, status_updated_at = now()
  where id = v_order.id;
  insert into public.audit_logs (actor_id, action, entity, entity_id, old_value, new_value)
  values (
    auth.uid(), 'pos.order.status', 'pos_order', v_order.id::text,
    jsonb_build_object('status', v_order.status),
    jsonb_build_object('status', p_status)
  );
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
  if not (
    coalesce(public.has_permission('orders.manage'), false)
    or coalesce(public.has_permission('orders.view'), false)
    or coalesce(public.has_permission('orders.update_status'), false)
    or coalesce(public.has_permission('orders.create'), false)
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  return query
  select jsonb_build_object(
    'id', o.id, 'order_number', o.order_number, 'status', o.status,
    'customer_id', o.customer_id, 'checkin_id', o.checkin_id,
    'customer_name', c.full_name, 'customer_code', c.code, 'created_at', o.created_at,
    'subtotal', o.subtotal, 'discount_total', o.discount_total,
    'service_amount', o.service_amount, 'tax_amount', o.tax_amount,
    'total', o.total, 'currency', o.currency,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name_en', i.product_name_en, 'name_ar', i.product_name_ar,
        'quantity', i.quantity, 'line_total', i.line_total
      ) order by i.id)
      from public.pos_order_items i where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.pos_orders o
  join public.customers c on c.id = o.customer_id
  where o.status in ('open', 'new', 'preparing', 'ready', 'served')
  order by o.created_at;
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
  v_shift public.pos_shifts;
  v_qualifies boolean;
  v_prefix text;
  v_timer_reset_on text;
  v_require_shift boolean;
begin
  if not coalesce(public.has_permission('orders.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_payment_method not in ('cash', 'card', 'other') then
    raise exception using errcode = '22023', message = 'invalid payment method';
  end if;
  select * into v_order
  from public.pos_orders
  where id = p_order and status in ('served', 'open')
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'order must be served before payment'; end if;

  select * into v_shift
  from public.pos_shifts where user_id = auth.uid() and closed_at is null
  limit 1 for update;
  select coalesce((value #>> '{}')::boolean, false) into v_require_shift
  from public.settings where key = 'ops.require_open_shift';
  if not found then v_require_shift := false; end if;
  if v_shift.id is null and v_require_shift then
    raise exception using errcode = 'P0002', message = 'open shift required';
  end if;

  select value #>> '{}' into v_prefix from public.settings where key = 'ops.receipt_prefix';
  select value #>> '{}' into v_timer_reset_on from public.settings where key = 'ops.timer_reset_on';
  update public.pos_orders
  set status = 'paid', completed_at = now(), shift_id = v_shift.id
      , status_updated_at = now()
  where id = v_order.id
  returning * into v_order;

  insert into public.pos_receipts (
    receipt_no, order_id, shift_id, issued_by, payment_method, currency, total
  )
  values (
    coalesce(v_prefix, 'R-') || lpad(nextval('public.receipt_number_seq')::text, 8, '0'),
    v_order.id, v_shift.id, auth.uid(), p_payment_method, v_order.currency, v_order.total
  )
  returning * into v_receipt;

  select exists (
    select 1 from public.pos_order_items
    where order_id = v_order.id and qualifies_for_time
  ) into v_qualifies;
  if v_qualifies and coalesce(v_timer_reset_on, 'order_paid') = 'order_paid' then
    update public.checkins
    set last_qualifying_order_at = now()
    where id = v_order.checkin_id and checked_out_at is null;
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'pos.order.complete', 'pos_order', v_order.id::text,
    jsonb_build_object(
      'receipt_id', v_receipt.id, 'receipt_no', v_receipt.receipt_no,
      'total', v_receipt.total, 'currency', v_receipt.currency,
      'payment_method', v_receipt.payment_method
    )
  );
  return jsonb_build_object(
    'order_id', v_order.id, 'receipt_id', v_receipt.id, 'receipt_no', v_receipt.receipt_no,
    'total', v_receipt.total, 'currency', v_receipt.currency,
    'payment_method', v_receipt.payment_method, 'qualifies_for_time', v_qualifies,
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
  if not coalesce(public.has_permission('orders.manage'), false)
     and not coalesce(public.has_permission('orders.cancel'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'cancellation reason required';
  end if;
  select * into v_order
  from public.pos_orders
  where id = p_order and status in ('open', 'new', 'preparing', 'ready')
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'order cannot be cancelled'; end if;

  update public.pos_orders
  set status = 'cancelled', cancelled_at = now(), status_updated_at = now()
  where id = v_order.id;
  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'pos.order.cancel', 'pos_order', v_order.id::text,
    jsonb_build_object('reason', btrim(p_reason), 'status', v_order.status)
  );
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
  v_alert numeric(12, 2);
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
  if not found then raise exception using errcode = 'P0002', message = 'open shift not found'; end if;
  if exists (select 1 from public.pos_orders where shift_id = p_shift and status in ('open', 'new', 'preparing', 'ready', 'served'))
     or exists (
       select 1 from public.visit_fees f
       where f.shift_id = p_shift
         and not exists (select 1 from public.visit_fee_waivers w where w.fee_id = f.id)
         and not exists (
           select 1 from public.pos_receipts r
           where r.fee_id = f.id and not exists (
             select 1 from public.pos_receipt_voids x where x.receipt_id = r.id
           )
         )
     ) then
    raise exception using errcode = '55000', message = 'shift has pending orders or fees';
  end if;

  select coalesce(sum(r.total), 0)::numeric(12, 2)
  into v_cash_sales
  from public.pos_receipts r
  where r.shift_id = v_shift.id and r.payment_method = 'cash'
    and not exists (select 1 from public.pos_receipt_voids x where x.receipt_id = r.id);
  v_expected := v_shift.opening_cash + v_cash_sales;
  select coalesce((value #>> '{}')::numeric, 50)
  into v_alert from public.settings where key = 'ops.cash_diff_alert';

  update public.pos_shifts
  set closed_at = now(), counted_cash = round(p_counted_cash, 2),
      expected_cash = v_expected, variance = round(p_counted_cash, 2) - v_expected
  where id = v_shift.id returning * into v_shift;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'pos.shift.close', 'pos_shift', v_shift.id::text,
    jsonb_build_object(
      'counted_cash', v_shift.counted_cash, 'expected_cash', v_shift.expected_cash,
      'variance', v_shift.variance, 'cash_diff_alert', abs(v_shift.variance) >= coalesce(v_alert, 50)
    )
  );
  return jsonb_build_object(
    'shift', to_jsonb(v_shift), 'cash_diff_alert', abs(v_shift.variance) >= coalesce(v_alert, 50),
    'server_now', now()
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
  v_prefix text;
  v_require_shift boolean;
begin
  if not coalesce(public.has_permission('orders.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_payment_method not in ('cash', 'card', 'other') then
    raise exception using errcode = '22023', message = 'invalid payment method';
  end if;
  select * into v_fee from public.visit_fees where id = p_fee for update;
  if not found or exists (select 1 from public.visit_fee_waivers where fee_id = p_fee)
     or exists (
       select 1 from public.pos_receipts r
       where r.fee_id = p_fee and not exists (
         select 1 from public.pos_receipt_voids v where v.receipt_id = r.id
       )
     ) then
    raise exception using errcode = 'P0002', message = 'unpaid active fee not found';
  end if;

  select * into v_shift from public.pos_shifts
  where user_id = auth.uid() and closed_at is null limit 1 for update;
  select coalesce((value #>> '{}')::boolean, false) into v_require_shift
  from public.settings where key = 'ops.require_open_shift';
  if not found then v_require_shift := false; end if;
  if v_shift.id is null and v_require_shift then
    raise exception using errcode = 'P0002', message = 'open shift required';
  end if;

  select value #>> '{}' into v_prefix from public.settings where key = 'ops.receipt_prefix';
  insert into public.pos_receipts (
    receipt_no, fee_id, shift_id, issued_by, payment_method, currency, total
  )
  values (
    coalesce(v_prefix, 'R-') || lpad(nextval('public.receipt_number_seq')::text, 8, '0'),
    v_fee.id, v_shift.id, auth.uid(), p_payment_method, v_fee.currency, v_fee.amount
  ) returning * into v_receipt;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'pos.fee.pay', 'visit_fee', v_fee.id::text,
    jsonb_build_object(
      'receipt_no', v_receipt.receipt_no, 'amount', v_receipt.total,
      'currency', v_receipt.currency, 'payment_method', p_payment_method
    )
  );
  return jsonb_build_object(
    'receipt_no', v_receipt.receipt_no, 'total', v_receipt.total,
    'currency', v_receipt.currency, 'payment_method', v_receipt.payment_method,
    'server_now', now()
  );
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
  v_grace integer;
  v_repeats boolean;
  v_require_shift boolean;
  v_deadline timestamptz;
  v_elapsed_intervals bigint;
  v_fee numeric(12, 2) := 0;
  v_fee_row public.visit_fees;
begin
  if not coalesce(public.has_permission('checkins.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  select * into v_checkin from public.checkins
  where id = p_checkin and checked_out_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'visit not found or already closed'; end if;
  if exists (select 1 from public.visit_fees where checkin_id = v_checkin.id) then
    raise exception using errcode = '23505', message = 'visit fee already calculated';
  end if;

  select * into v_shift from public.pos_shifts
  where user_id = auth.uid() and closed_at is null limit 1 for update;
  select coalesce((value #>> '{}')::boolean, false) into v_require_shift
  from public.settings where key = 'ops.require_open_shift';
  if not found then v_require_shift := false; end if;
  if v_shift.id is null and v_require_shift then
    raise exception using errcode = 'P0002', message = 'open shift required';
  end if;

  select value #>> '{}' into v_currency from public.settings where key = 'ops.currency';
  select (value #>> '{}')::numeric into v_fee_amount from public.settings where key = 'ops.fee_amount';
  select (value #>> '{}')::integer into v_interval from public.settings where key = 'ops.fee_interval_minutes';
  select (value #>> '{}')::integer into v_duration from public.settings where key = 'ops.visit_duration_minutes';
  select (value #>> '{}')::integer into v_grace from public.settings where key = 'ops.timer_grace_minutes';
  select (value #>> '{}')::boolean into v_repeats from public.settings where key = 'ops.fee_repeats';
  v_deadline := greatest(
    v_checkin.timer_started_at,
    coalesce(v_checkin.last_qualifying_order_at, v_checkin.timer_started_at)
  ) + make_interval(mins => coalesce(v_duration, 180) + coalesce(v_grace, 0));

  if now() > v_deadline and coalesce(v_fee_amount, 0) > 0 then
    v_elapsed_intervals := case
      when coalesce(v_repeats, true) then ceil(extract(epoch from (now() - v_deadline)) / (coalesce(v_interval, 30) * 60))
      else 1
    end;
    v_fee := round(v_elapsed_intervals * v_fee_amount, 2);
    insert into public.visit_fees (checkin_id, shift_id, currency, amount)
    values (v_checkin.id, v_shift.id, coalesce(v_currency, 'EGP'), v_fee)
    returning * into v_fee_row;
  end if;

  update public.checkins set checked_out_at = now(), closed_by = auth.uid()
  where id = v_checkin.id;
  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'checkin.checkout', 'checkin', v_checkin.id::text,
    jsonb_build_object('fees_due', v_fee, 'currency', coalesce(v_currency, 'EGP'))
  );
  return jsonb_build_object(
    'checkin_id', v_checkin.id, 'checked_out_at', now(), 'fees_due', v_fee,
    'fee_id', v_fee_row.id, 'currency', coalesce(v_currency, 'EGP'), 'server_now', now()
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
  v_warning integer;
  v_deadline timestamptz;
begin
  if not coalesce(public.has_permission('scanner.use'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if length(v_input) > 512 then v_input := ''; end if;
  select * into c from public.customers
  where deleted_at is null and (qr_token = v_input or upper(code) = upper(v_input))
  limit 1;
  if not found then
    insert into public.scan_logs (user_id, result) values (auth.uid(), 'unknown');
    return jsonb_build_object('ok', false, 'reason', 'unknown', 'server_now', now());
  end if;

  v_result := case
    when c.status = 'blocked' then 'blocked'
    when c.status = 'expired' or (c.expiry_date is not null and c.expiry_date < current_date) then 'expired'
    else 'ok'
  end;
  insert into public.scan_logs (user_id, customer_id, result) values (auth.uid(), c.id, v_result);

  select * into v_checkin from public.checkins
  where customer_id = c.id and checked_out_at is null
  order by checked_in_at desc limit 1;
  select coalesce((value #>> '{}')::integer, 180) into v_duration
  from public.settings where key = 'ops.visit_duration_minutes';
  select coalesce((value #>> '{}')::integer, 15) into v_warning
  from public.settings where key = 'ops.timer_warning_minutes';
  if v_checkin.id is not null then
    v_deadline := greatest(
      v_checkin.timer_started_at,
      coalesce(v_checkin.last_qualifying_order_at, v_checkin.timer_started_at)
    ) + make_interval(mins => coalesce(v_duration, 180));
  end if;
  return jsonb_build_object(
    'ok', v_result = 'ok', 'reason', v_result,
    'customer', jsonb_build_object(
      'id', c.id, 'code', c.code, 'first_name', c.first_name,
      'last_name', c.last_name, 'birth_date', c.birth_date
    ),
    'checkin', case when v_checkin.id is not null then to_jsonb(v_checkin) else null end,
    'deadline', v_deadline,
    'warning_at', case when v_deadline is not null then v_deadline - make_interval(mins => coalesce(v_warning, 15)) else null end,
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
  v_warning integer;
  v_deadline timestamptz;
begin
  if not coalesce(public.has_permission('checkins.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  select * into v_checkin from public.checkins
  where id = p_checkin and checked_out_at is null;
  if not found then raise exception using errcode = 'P0002', message = 'open visit not found'; end if;
  select coalesce((value #>> '{}')::integer, 180) into v_duration
  from public.settings where key = 'ops.visit_duration_minutes';
  select coalesce((value #>> '{}')::integer, 15) into v_warning
  from public.settings where key = 'ops.timer_warning_minutes';
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

revoke all on function public.get_pos_settings() from public, anon;
revoke all on function public.update_pos_settings(text, integer, integer, numeric, text, numeric, numeric, integer, integer, boolean, text, boolean, text, numeric) from public, anon;
revoke all on function public.list_pos_categories() from public, anon;
revoke all on function public.save_pos_category(uuid, text, text, integer, boolean) from public, anon;
revoke all on function public.list_pos_products() from public, anon;
revoke all on function public.save_pos_menu_item(uuid, uuid, text, text, text, numeric, boolean, boolean, boolean, text, integer) from public, anon;
revoke all on function public.create_pos_order(uuid, bigint, jsonb, text, numeric, text) from public, anon;
revoke all on function public.set_pos_order_status(uuid, text) from public, anon;
revoke all on function public.list_open_pos_orders() from public, anon;
revoke all on function public.complete_pos_order(uuid, text) from public, anon;
revoke all on function public.cancel_pos_order(uuid, text) from public, anon;
revoke all on function public.close_pos_shift(uuid, numeric) from public, anon;
revoke all on function public.pay_visit_fee(uuid, text) from public, anon;
revoke all on function public.check_out(bigint) from public, anon;
revoke all on function public.scan_customer(text) from public, anon;
revoke all on function public.get_visit_timer(bigint) from public, anon;

grant execute on function public.get_pos_settings() to authenticated;
grant execute on function public.update_pos_settings(text, integer, integer, numeric, text, numeric, numeric, integer, integer, boolean, text, boolean, text, numeric) to authenticated;
grant execute on function public.list_pos_categories() to authenticated;
grant execute on function public.save_pos_category(uuid, text, text, integer, boolean) to authenticated;
grant execute on function public.list_pos_products() to authenticated;
grant execute on function public.save_pos_menu_item(uuid, uuid, text, text, text, numeric, boolean, boolean, boolean, text, integer) to authenticated;
grant execute on function public.create_pos_order(uuid, bigint, jsonb, text, numeric, text) to authenticated;
grant execute on function public.set_pos_order_status(uuid, text) to authenticated;
grant execute on function public.list_open_pos_orders() to authenticated;
grant execute on function public.complete_pos_order(uuid, text) to authenticated;
grant execute on function public.cancel_pos_order(uuid, text) to authenticated;
grant execute on function public.close_pos_shift(uuid, numeric) to authenticated;
grant execute on function public.pay_visit_fee(uuid, text) to authenticated;
grant execute on function public.check_out(bigint) to authenticated;
grant execute on function public.scan_customer(text) to authenticated;
grant execute on function public.get_visit_timer(bigint) to authenticated;

commit;
