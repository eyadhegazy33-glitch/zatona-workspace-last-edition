begin;

do $$
declare
  v_table text;
begin
  grant usage on schema public to authenticated;

  foreach v_table in array array[
    'orders',
    'order_items',
    'fees',
    'receipts',
    'receipt_lines',
    'shift_sessions',
    'shifts',
    'shift_assignments',
    'shift_swap_requests',
    'pos_orders',
    'pos_order_items',
    'pos_menu_categories',
    'pos_products'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format('grant select on public.%I to authenticated', v_table);
    end if;
  end loop;

  foreach v_table in array array[
    'pos_menu_categories',
    'pos_products',
    'shifts',
    'shift_assignments'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format('grant insert, update on public.%I to authenticated', v_table);
    end if;
  end loop;
end
$$;

create or replace function public.list_receipts(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_search text default null,
  p_method text default null,
  p_status text default null,
  p_employee uuid default null,
  p_min numeric default null,
  p_max numeric default null,
  p_limit int default 25,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_all boolean := coalesce(public.has_permission('receipts.view'), false);
  v_own boolean := coalesce(public.has_permission('receipts.view_own'), false);
  v_search text := nullif(btrim(p_search), '');
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 5000);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  if auth.uid() is null or not (v_all or v_own) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_method is not null and p_method not in ('cash', 'card', 'wallet', 'other') then
    raise exception using errcode = '22023', message = 'invalid payment method';
  end if;
  if p_status is not null and p_status not in ('paid', 'voided') then
    raise exception using errcode = '22023', message = 'invalid receipt status';
  end if;
  if (p_min is not null and p_min < 0)
     or (p_max is not null and p_max < 0)
     or (p_min is not null and p_max is not null and p_min > p_max) then
    raise exception using errcode = '22023', message = 'invalid amount range';
  end if;
  if p_from is not null and p_to is not null and p_from >= p_to then
    raise exception using errcode = '22023', message = 'invalid date range';
  end if;
  if length(coalesce(p_search, '')) > 200
     or coalesce(p_limit, 25) < 1
     or coalesce(p_limit, 25) > 5000
     or coalesce(p_offset, 0) < 0 then
    raise exception using errcode = '22023', message = 'invalid receipt query';
  end if;

  with filtered as materialized (
    select
      r.id,
      r.number,
      r.created_at,
      r.method,
      r.status,
      r.total,
      r.amount_received,
      r.note,
      r.created_by,
      r.shift_session_id,
      coalesce(c.full_name, concat_ws(' ', c.first_name, c.last_name)) as customer_name,
      c.code as customer_code,
      nullif(concat_ws(' ', employee.first_name, employee.last_name), '') as employee_name
    from public.receipts r
    join public.customers c on c.id = r.customer_id
    left join public.profiles employee on employee.id = r.created_by
    where (v_all or (v_own and r.created_by = auth.uid()))
      and (p_from is null or r.created_at >= p_from)
      and (p_to is null or r.created_at < p_to)
      and (p_method is null or r.method = p_method)
      and (p_status is null or r.status = p_status)
      and (p_employee is null or r.created_by = p_employee)
      and (p_min is null or r.total >= p_min)
      and (p_max is null or r.total <= p_max)
      and (
        v_search is null
        or r.number::text = regexp_replace(v_search, '\D', '', 'g')
        or coalesce(c.full_name, concat_ws(' ', c.first_name, c.last_name))
          ilike '%' || v_search || '%'
        or c.code ilike '%' || v_search || '%'
      )
  ),
  summary as (
    select
      count(*) as total_count,
      count(*) filter (where status = 'paid') as paid_count,
      coalesce(sum(total) filter (where status = 'paid'), 0) as paid_total,
      count(*) filter (where status = 'voided') as voided_count
    from filtered
  ),
  page as (
    select *
    from filtered
    order by created_at desc, id desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'rows', coalesce(
      (select jsonb_agg(to_jsonb(page) order by page.created_at desc, page.id desc) from page),
      '[]'::jsonb
    ),
    'total_count', summary.total_count,
    'paid_count', summary.paid_count,
    'paid_total', summary.paid_total,
    'voided_count', summary.voided_count,
    'by_method', coalesce((
      select jsonb_object_agg(method_totals.method, method_totals.total)
      from (
        select method, sum(total) as total
        from filtered
        where status = 'paid'
        group by method
      ) method_totals
    ), '{}'::jsonb)
  )
  into v_result
  from summary;

  return v_result;
end;
$$;

create or replace function public.get_receipt(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_receipt public.receipts;
  v_all boolean := coalesce(public.has_permission('receipts.view'), false);
  v_own boolean := coalesce(public.has_permission('receipts.view_own'), false);
begin
  if auth.uid() is null or not (v_all or v_own) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select *
  into v_receipt
  from public.receipts r
  where r.id = p_id
    and (v_all or (v_own and r.created_by = auth.uid()));

  if not found then
    raise exception using errcode = 'P0002', message = 'receipt not found';
  end if;

  return jsonb_build_object(
    'id', v_receipt.id,
    'number', v_receipt.number,
    'created_at', v_receipt.created_at,
    'method', v_receipt.method,
    'status', v_receipt.status,
    'total', v_receipt.total,
    'amount_received', v_receipt.amount_received,
    'note', v_receipt.note,
    'void_reason', v_receipt.void_reason,
    'voided_at', v_receipt.voided_at,
    'shift_session_id', v_receipt.shift_session_id,
    'customer', (
      select jsonb_build_object(
        'name', coalesce(c.full_name, concat_ws(' ', c.first_name, c.last_name)),
        'code', c.code
      )
      from public.customers c
      where c.id = v_receipt.customer_id
    ),
    'employee', (
      select nullif(concat_ws(' ', p.first_name, p.last_name), '')
      from public.profiles p
      where p.id = v_receipt.created_by
    ),
    'voided_by', (
      select nullif(concat_ws(' ', p.first_name, p.last_name), '')
      from public.profiles p
      where p.id = v_receipt.voided_by
    ),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', line.line_type,
        'description', line.description,
        'amount', line.amount
      ) order by line.id)
      from public.receipt_lines line
      where line.receipt_id = v_receipt.id
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'order_number', order_row.number,
        'description', order_row.description,
        'amount', line.amount
      ) order by order_row.number, order_row.id)
      from public.receipt_lines line
      join public.orders order_row on order_row.id = line.order_id
      where line.receipt_id = v_receipt.id
        and line.line_type = 'order'
    ), '[]'::jsonb),
    'amounts', jsonb_build_object(
      'subtotal', coalesce((
        select sum(order_row.subtotal)
        from public.orders order_row
        where order_row.id in (
          select line.order_id
          from public.receipt_lines line
          where line.receipt_id = v_receipt.id and line.line_type = 'order'
        )
      ), 0),
      'discount', coalesce((
        select sum(order_row.discount)
        from public.orders order_row
        where order_row.id in (
          select line.order_id
          from public.receipt_lines line
          where line.receipt_id = v_receipt.id and line.line_type = 'order'
        )
      ), 0),
      'service', coalesce((
        select sum(order_row.service_charge)
        from public.orders order_row
        where order_row.id in (
          select line.order_id
          from public.receipt_lines line
          where line.receipt_id = v_receipt.id and line.line_type = 'order'
        )
      ), 0),
      'tax', coalesce((
        select sum(order_row.tax)
        from public.orders order_row
        where order_row.id in (
          select line.order_id
          from public.receipt_lines line
          where line.receipt_id = v_receipt.id and line.line_type = 'order'
        )
      ), 0),
      'fees', coalesce((
        select sum(line.amount)
        from public.receipt_lines line
        where line.receipt_id = v_receipt.id and line.line_type = 'fee'
      ), 0)
    )
  );
end;
$$;

create or replace function public.get_my_shift()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.shift_sessions;
begin
  if auth.uid() is null or not coalesce(public.has_permission('shifts.use'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select *
  into v_session
  from public.shift_sessions
  where user_id = auth.uid() and closed_at is null
  order by opened_at desc
  limit 1;

  return jsonb_build_object(
    'open', case
      when v_session.id is not null then public.get_shift_summary(v_session.id)
      else null
    end,
    'last_note', public.last_handover_note(),
    'last_counted_cash', (
      select cash_counted
      from public.shift_sessions
      where closed_at is not null and cash_counted is not null
      order by closed_at desc
      limit 1
    ),
    'require_open_shift', coalesce(public.ops_text('ops.require_open_shift', 'false'), 'false') = 'true'
  );
end;
$$;

create or replace function public.get_team_shifts(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  id uuid,
  user_name text,
  opened_at timestamptz,
  closed_at timestamptz,
  opening_cash numeric,
  cash_expected numeric,
  cash_counted numeric,
  difference numeric,
  orders_count bigint,
  unpaid_orders bigint,
  receipts_total numeric,
  note text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not coalesce(public.has_permission('shifts.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_from is null or p_to is null or p_from >= p_to
     or p_to - p_from > interval '400 days' then
    raise exception using errcode = '22023', message = 'invalid shift date range';
  end if;

  return query
  select
    session.id,
    nullif(concat_ws(' ', employee.first_name, employee.last_name), ''),
    session.opened_at,
    session.closed_at,
    session.opening_cash,
    session.cash_expected,
    session.cash_counted,
    case when session.closed_at is not null
      then session.cash_counted - session.cash_expected
    end,
    (
      select count(*)
      from public.orders order_row
      where order_row.shift_session_id = session.id
        and order_row.status <> 'cancelled'
    ),
    (
      select count(*)
      from public.orders order_row
      where order_row.shift_session_id = session.id
        and order_row.status <> 'cancelled'
        and order_row.receipt_id is null
    ),
    coalesce((
      select sum(receipt.total)
      from public.receipts receipt
      where receipt.shift_session_id = session.id
        and receipt.status = 'paid'
    ), 0),
    session.note
  from public.shift_sessions session
  join public.profiles employee on employee.id = session.user_id
  where session.opened_at >= p_from and session.opened_at < p_to
  order by (session.closed_at is null) desc, session.opened_at desc
  limit 500;
end;
$$;

revoke all on function public.list_receipts(
  timestamptz, timestamptz, text, text, text, uuid, numeric, numeric, int, int
) from public, anon;
revoke all on function public.get_receipt(uuid) from public, anon;
revoke all on function public.get_my_shift() from public, anon;
revoke all on function public.get_team_shifts(timestamptz, timestamptz) from public, anon;
grant execute on function public.list_receipts(
  timestamptz, timestamptz, text, text, text, uuid, numeric, numeric, int, int
) to authenticated;
grant execute on function public.get_receipt(uuid) to authenticated;
grant execute on function public.get_my_shift() to authenticated;
grant execute on function public.get_team_shifts(timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';

commit;
