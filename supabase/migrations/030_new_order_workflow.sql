begin;

alter table public.pos_orders
  add column if not exists note text;

alter table public.pos_order_items
  add column if not exists note text;

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

insert into public.permissions (key, description)
values ('orders.discount', 'Apply a reasoned discount to an order')
on conflict (key) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_key)
select rp.role_id, 'orders.discount'
from public.role_permissions rp
where rp.permission_key = 'discounts.apply'
on conflict (role_id, permission_key) do nothing;

drop policy if exists pos_products_order_read on public.pos_products;
create policy pos_products_order_read
  on public.pos_products for select to authenticated
  using (
    (
      coalesce(public.has_permission('orders.create'), false)
      or coalesce(public.has_permission('orders.manage'), false)
    )
    and active
  );

grant select on public.pos_products to authenticated;

drop policy if exists pos_menu_categories_order_read
  on public.pos_menu_categories;
create policy pos_menu_categories_order_read
  on public.pos_menu_categories for select to authenticated
  using (
    (
      coalesce(public.has_permission('orders.create'), false)
      or coalesce(public.has_permission('orders.manage'), false)
    )
    and active
  );

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
    or coalesce(public.has_permission('orders.create'), false)
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
    or coalesce(public.has_permission('orders.create'), false)
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

create or replace function public.search_order_customers(p_query text)
returns setof jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_query text;
begin
  if not (
    coalesce(public.has_permission('orders.create'), false)
    or coalesce(public.has_permission('orders.manage'), false)
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_query is null or length(btrim(p_query)) not between 2 and 100 then
    raise exception using errcode = '22023', message = 'invalid customer search';
  end if;

  v_query := replace(
    replace(replace(btrim(p_query), chr(92), chr(92) || chr(92)), '%', chr(92) || '%'),
    '_',
    chr(92) || '_'
  );
  return query
  select jsonb_build_object(
    'id', c.id,
    'code', c.code,
    'first_name', c.first_name,
    'last_name', c.last_name
  )
  from public.customers c
  where c.deleted_at is null
    and (
      c.first_name ilike '%' || v_query || '%' escape chr(92)
      or c.last_name ilike '%' || v_query || '%' escape chr(92)
      or c.code ilike '%' || v_query || '%' escape chr(92)
    )
  order by c.last_name, c.first_name
  limit 20;
end;
$$;

create or replace function public.create_order(
  p_customer uuid,
  p_items jsonb,
  p_note text default null,
  p_discount numeric default 0,
  p_discount_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_checkin bigint;
  v_item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_item_id uuid;
  v_quantity integer;
  v_item_note text;
  v_order_result jsonb;
  v_order_id uuid;
  v_order_number bigint;
  v_subtotal numeric(12, 2);
  v_discount numeric(12, 2) := 0;
  v_service numeric(12, 2);
  v_tax numeric(12, 2);
  v_total numeric(12, 2);
  v_currency text;
  v_discount_reason text := nullif(btrim(p_discount_reason), '');
  v_timer_reset_on text;
  v_timer_restarted boolean := false;
begin
  if not coalesce(public.has_permission('orders.create'), false)
     and not coalesce(public.has_permission('orders.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_customer is null then
    raise exception using errcode = '22023', message = 'customer required';
  end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception using errcode = '22023', message = 'invalid order items';
  end if;
  if length(coalesce(p_note, '')) > 500 then
    raise exception using errcode = '22023', message = 'order note is too long';
  end if;
  if p_discount is null or p_discount < 0 or p_discount > 1000000 then
    raise exception using errcode = '22023', message = 'invalid discount';
  end if;
  if p_discount > 0 then
    if not coalesce(public.has_permission('orders.discount'), false)
       and not coalesce(public.has_permission('discounts.apply'), false) then
      raise exception using errcode = '42501', message = 'discount not allowed';
    end if;
    if v_discount_reason is null or length(v_discount_reason) not between 3 and 250 then
      raise exception using errcode = '22023', message = 'discount reason required';
    end if;
  elsif v_discount_reason is not null then
    raise exception using errcode = '22023', message = 'discount reason requires a discount';
  end if;

  select k.id into v_checkin
  from public.checkins k
  where k.customer_id = p_customer and k.checked_out_at is null
  order by k.checked_in_at desc
  limit 1
  for update;
  if v_checkin is null then
    raise exception using errcode = 'P0002', message = 'customer not checked in';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or nullif(v_item->>'menu_item_id', '') is null
       or nullif(v_item->>'quantity', '') is null then
      raise exception using errcode = '22023', message = 'invalid order item';
    end if;
    begin
      v_item_id := (v_item->>'menu_item_id')::uuid;
      v_quantity := (v_item->>'quantity')::integer;
    exception when others then
      raise exception using errcode = '22023', message = 'invalid order item';
    end;
    if v_quantity not between 1 and 50
       or exists (
         select 1
         from jsonb_array_elements(v_items) previous(value)
         where previous.value->>'product_id' = v_item_id::text
       ) then
      raise exception using errcode = '22023', message = 'invalid order quantity or duplicate item';
    end if;
    v_item_note := nullif(btrim(v_item->>'note'), '');
    if length(coalesce(v_item_note, '')) > 150 then
      raise exception using errcode = '22023', message = 'item note is too long';
    end if;
    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_item_id,
        'quantity', v_quantity,
        'note', v_item_note
      )
    );
  end loop;

  v_order_result := public.create_pos_order(
    p_customer,
    v_checkin,
    (select jsonb_agg(jsonb_build_object(
      'product_id', value->>'product_id',
      'quantity', value->>'quantity'
    )) from jsonb_array_elements(v_items)),
    null,
    0,
    null
  );
  v_order_id := (v_order_result->>'order_id')::uuid;
  v_order_number := (v_order_result->>'order_number')::bigint;
  v_subtotal := (v_order_result->>'subtotal')::numeric;
  v_currency := v_order_result->>'currency';

  if p_discount > 0 then
    v_discount := least(v_subtotal, round(p_discount, 2));
  end if;
  select coalesce((value #>> '{}')::numeric, 0)
    into v_service from public.settings where key = 'ops.service_percent';
  select coalesce((value #>> '{}')::numeric, 0)
    into v_tax from public.settings where key = 'ops.tax_percent';
  v_service := round((v_subtotal - v_discount) * coalesce(v_service, 0) / 100, 2);
  v_tax := round((v_subtotal - v_discount + v_service) * coalesce(v_tax, 0) / 100, 2);
  v_total := greatest(0, v_subtotal - v_discount + v_service + v_tax);

  update public.pos_orders
  set note = nullif(btrim(p_note), ''),
      discount_type = case when v_discount > 0 then 'amount' else null end,
      discount_value = v_discount,
      discount_total = v_discount,
      discount_reason = case when v_discount > 0 then v_discount_reason else null end,
      service_amount = v_service,
      tax_amount = v_tax,
      total = v_total
  where id = v_order_id;

  for v_item in select value from jsonb_array_elements(v_items)
  loop
    update public.pos_order_items
    set note = nullif(v_item->>'note', '')
    where order_id = v_order_id
      and product_id = (v_item->>'product_id')::uuid;
  end loop;

  if v_discount > 0 then
    insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
    values (
      auth.uid(), 'pos.order.discount', 'pos_order', v_order_id::text,
      jsonb_build_object('discount_total', v_discount, 'reason', v_discount_reason)
    );
  end if;

  select coalesce(value #>> '{}', 'order_paid')
    into v_timer_reset_on from public.settings where key = 'ops.timer_reset_on';
  select v_timer_reset_on = 'order_created' and exists (
    select 1 from public.pos_order_items
    where order_id = v_order_id and qualifies_for_time
  ) into v_timer_restarted;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'subtotal', v_subtotal,
    'discount_total', v_discount,
    'service_amount', v_service,
    'tax_amount', v_tax,
    'total', v_total,
    'currency', v_currency,
    'timer_restarted', coalesce(v_timer_restarted, false),
    'server_now', now(),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name_en', i.product_name_en,
        'name_ar', i.product_name_ar,
        'quantity', i.quantity,
        'note', i.note
      ) order by i.id)
      from public.pos_order_items i
      where i.order_id = v_order_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.create_order(uuid, jsonb, text, numeric, text)
  from public, anon;
revoke all on function public.search_order_customers(text) from public, anon;
grant execute on function public.create_order(uuid, jsonb, text, numeric, text)
  to authenticated;
grant execute on function public.search_order_customers(text) to authenticated;
revoke all on function public.check_in(uuid, uuid) from public, anon;
grant execute on function public.check_in(uuid, uuid) to authenticated;

commit;
