begin;

drop policy if exists pos_orders_realtime_read on public.pos_orders;
create policy pos_orders_realtime_read
  on public.pos_orders for select to authenticated
  using (coalesce(public.has_permission('orders.view'), false));

grant select on public.pos_orders to authenticated;

create or replace function public.set_order_status(p_order uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
begin
  if not (
    coalesce(public.has_permission('orders.update_status'), false)
    or coalesce(public.has_permission('orders.manage'), false)
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  if p_status = 'preparing' then
    select status
      into v_status
    from public.pos_orders
    where id = p_order
    for update;
    if v_status = 'open' then
      update public.pos_orders
      set status = 'preparing', status_updated_at = pg_catalog.now()
      where id = p_order;
      insert into public.audit_logs (
        actor_id, action, entity, entity_id, old_value, new_value
      )
      values (
        auth.uid(), 'pos.order.status', 'pos_order', p_order::text,
        jsonb_build_object('status', 'open'),
        jsonb_build_object('status', 'preparing')
      );
      return;
    end if;
  end if;

  perform public.set_pos_order_status(p_order, p_status);
end;
$$;

create or replace function public.list_order_board()
returns setof jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
begin
  if not (
    coalesce(public.has_permission('orders.view'), false)
    or coalesce(public.has_permission('orders.manage'), false)
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  return query
  select jsonb_build_object(
    'id', o.id,
    'order_number', o.order_number,
    'status', case when o.status = 'open' then 'new' else o.status end,
    'customer_first_name', c.first_name,
    'created_at', o.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name_en', i.product_name_en,
        'name_ar', i.product_name_ar,
        'quantity', i.quantity,
        'note', i.note
      ) order by i.id)
      from public.pos_order_items i
      where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.pos_orders o
  join public.customers c on c.id = o.customer_id
  where o.status in ('open', 'new', 'preparing', 'ready')
  order by o.created_at;
end;
$$;

create or replace function public.list_orders(
  p_from date default null,
  p_to date default null,
  p_status text default null,
  p_search text default null,
  p_unpaid_only boolean default false
)
returns setof jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_search text := nullif(btrim(p_search), '');
  v_timezone text;
begin
  if not (
    coalesce(public.has_permission('orders.view'), false)
    or coalesce(public.has_permission('orders.manage'), false)
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception using errcode = '22023', message = 'invalid date range';
  end if;
  if p_status is not null and p_status not in (
    'all', 'open', 'new', 'preparing', 'ready', 'served',
    'paid', 'cancelled', 'voided'
  ) then
    raise exception using errcode = '22023', message = 'invalid order status';
  end if;
  if length(coalesce(v_search, '')) > 100 then
    raise exception using errcode = '22023', message = 'customer search is too long';
  end if;
  select coalesce(value #>> '{}', 'Africa/Cairo')
    into v_timezone
  from public.settings
  where key = 'ops.timezone';
  v_timezone := coalesce(v_timezone, 'Africa/Cairo');

  return query
  select jsonb_build_object(
    'id', o.id,
    'order_number', o.order_number,
    'status', o.status,
    'created_at', o.created_at,
    'customer_id', c.id,
    'customer_name', c.full_name,
    'customer_first_name', c.first_name,
    'customer_code', c.code,
    'total', o.total,
    'currency', o.currency,
    'paid', r.id is not null and rv.id is null,
    'receipt_no', r.receipt_no,
    'receipt_id', r.id
  )
  from public.pos_orders o
  join public.customers c on c.id = o.customer_id
  left join public.pos_receipts r on r.order_id = o.id
  left join public.pos_receipt_voids rv on rv.receipt_id = r.id
  where (p_from is null or o.created_at >= (p_from::timestamp at time zone v_timezone))
    and (p_to is null or o.created_at < ((p_to + 1)::timestamp at time zone v_timezone))
    and (p_status is null or p_status = 'all' or o.status = p_status)
    and (
      not coalesce(p_unpaid_only, false)
      or r.id is null
      or rv.id is not null
    )
    and (
      v_search is null
      or pg_catalog.strpos(pg_catalog.lower(c.full_name), pg_catalog.lower(v_search)) > 0
      or pg_catalog.strpos(pg_catalog.lower(c.code), pg_catalog.lower(v_search)) > 0
    )
  order by o.created_at desc
  limit 500;
end;
$$;

create or replace function public.get_order_detail(p_order uuid)
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
    coalesce(public.has_permission('orders.view'), false)
    or coalesce(public.has_permission('orders.manage'), false)
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select jsonb_build_object(
    'id', o.id,
    'order_number', o.order_number,
    'status', o.status,
    'created_at', o.created_at,
    'status_updated_at', o.status_updated_at,
    'customer_id', c.id,
    'customer_name', c.full_name,
    'customer_first_name', c.first_name,
    'customer_code', c.code,
    'receipt_no', r.receipt_no,
    'receipt_id', r.id,
    'note', o.note,
    'subtotal', o.subtotal,
    'discount_total', o.discount_total,
    'discount_reason', o.discount_reason,
    'service_amount', o.service_amount,
    'tax_amount', o.tax_amount,
    'total', o.total,
    'currency', o.currency,
    'paid', r.id is not null and rv.id is null,
    'receipt', case when r.id is null then null else jsonb_build_object(
      'id', r.id,
      'receipt_no', r.receipt_no,
      'issued_at', r.issued_at,
      'payment_method', r.payment_method,
      'total', r.total,
      'voided', rv.id is not null,
      'void_reason', rv.reason
    ) end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name_en', i.product_name_en,
        'name_ar', i.product_name_ar,
        'quantity', i.quantity,
        'unit_price', i.unit_price,
        'line_total', i.line_total,
        'note', i.note
      ) order by i.id)
      from public.pos_order_items i
      where i.order_id = o.id
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(event_row.event order by event_row.occurred_at)
      from (
        select o.created_at as occurred_at, jsonb_build_object(
          'at', o.created_at,
          'action', 'order.created',
          'actor', creator.first_name || ' ' || creator.last_name,
          'details', jsonb_build_object()
        ) as event
        from public.profiles creator
        where creator.id = o.created_by
        union all
        select a.created_at as occurred_at, jsonb_build_object(
          'at', a.created_at,
          'action', a.action,
          'actor', coalesce(actor.first_name || ' ' || actor.last_name, ''),
          'details', coalesce(a.new_value, jsonb_build_object())
        ) as event
        from public.audit_logs a
        left join public.profiles actor on actor.id = a.actor_id
        where a.entity = 'pos_order' and a.entity_id = o.id::text
        union all
        select rv.voided_at as occurred_at, jsonb_build_object(
          'at', rv.voided_at,
          'action', 'pos.receipt.void',
          'actor', coalesce(voider.first_name || ' ' || voider.last_name, ''),
          'details', jsonb_build_object('reason', rv.reason)
        ) as event
        from public.pos_receipt_voids rv
        join public.pos_receipts r on r.id = rv.receipt_id
        left join public.profiles voider on voider.id = rv.voided_by
        where r.order_id = o.id
      ) event_row
    ), '[]'::jsonb)
  )
  into v_result
  from public.pos_orders o
  join public.customers c on c.id = o.customer_id
  left join public.pos_receipts r on r.order_id = o.id
  left join public.pos_receipt_voids rv on rv.receipt_id = r.id
  where o.id = p_order;

  if v_result is null then
    raise exception using errcode = 'P0002', message = 'order not found';
  end if;
  return v_result;
end;
$$;

create or replace function public.cancel_order(p_order uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.pos_orders;
begin
  if not (
    coalesce(public.has_permission('orders.cancel'), false)
    or coalesce(public.has_permission('orders.manage'), false)
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'cancellation reason required';
  end if;

  select * into v_order
  from public.pos_orders
  where id = p_order
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'order not found';
  end if;
  if v_order.status = 'paid'
     or exists (
       select 1
       from public.pos_receipts r
       where r.order_id = p_order
         and not exists (
           select 1 from public.pos_receipt_voids rv where rv.receipt_id = r.id
         )
     ) then
    raise exception using errcode = '22023',
      message = 'paid order cannot be cancelled; void the receipt instead';
  end if;
  if v_order.status not in ('open', 'new', 'preparing', 'ready', 'served') then
    raise exception using errcode = '22023', message = 'order cannot be cancelled';
  end if;

  update public.pos_orders
  set status = 'cancelled',
      cancelled_at = pg_catalog.now(),
      status_updated_at = pg_catalog.now()
  where id = p_order;
  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'pos.order.cancel', 'pos_order', p_order::text,
    jsonb_build_object('reason', btrim(p_reason), 'status', v_order.status)
  );
end;
$$;

revoke all on function public.set_order_status(uuid, text) from public, anon;
revoke all on function public.list_order_board() from public, anon;
revoke all on function public.list_orders(date, date, text, text, boolean) from public, anon;
revoke all on function public.get_order_detail(uuid) from public, anon;
revoke all on function public.cancel_order(uuid, text) from public, anon;
grant execute on function public.set_order_status(uuid, text) to authenticated;
grant execute on function public.list_order_board() to authenticated;
grant execute on function public.list_orders(date, date, text, text, boolean) to authenticated;
grant execute on function public.get_order_detail(uuid) to authenticated;
grant execute on function public.cancel_order(uuid, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'pos_orders'
     ) then
    execute 'alter publication supabase_realtime add table public.pos_orders';
  end if;
end;
$$;

commit;
