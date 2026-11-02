begin;

create or replace function public.list_receipts_browser(
  p_search text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_method text default null,
  p_status text default null,
  p_min_amount numeric default null,
  p_max_amount numeric default null,
  p_sort text default 'created_at',
  p_direction text default 'desc',
  p_offset integer default 0,
  p_limit integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_receipts jsonb;
  v_total bigint;
  v_paid_count bigint;
  v_paid_total numeric(12, 2);
  v_voided_count bigint;
  v_prefix text;
begin
  if not coalesce(public.has_permission('receipts.view'), false)
     and not coalesce(public.has_permission('receipts.view_own'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_method is not null and p_method not in ('cash', 'card', 'wallet', 'other') then
    raise exception using errcode = '22023', message = 'invalid payment method';
  end if;
  if p_status is not null and p_status not in ('paid', 'voided') then
    raise exception using errcode = '22023', message = 'invalid receipt status';
  end if;
  if p_min_amount is not null and p_min_amount < 0
     or p_max_amount is not null and p_max_amount < 0
     or p_min_amount is not null and p_max_amount is not null
       and p_min_amount > p_max_amount then
    raise exception using errcode = '22023', message = 'invalid amount range';
  end if;
  if p_from is not null and p_to is not null and p_from >= p_to then
    raise exception using errcode = '22023', message = 'invalid date range';
  end if;
  if p_sort is null or p_sort not in (
    'created_at', 'number', 'customer', 'employee', 'total', 'status'
  ) or p_direction is null or p_direction not in ('asc', 'desc')
     or p_offset is null or p_offset < 0
     or p_limit is null or p_limit not between 1 and 5000
     or length(coalesce(p_search, '')) > 200 then
    raise exception using errcode = '22023', message = 'invalid receipt query';
  end if;

  v_prefix := coalesce(
    (select s.value #>> '{}' from public.settings s where s.key = 'ops.receipt_prefix'),
    'R-'
  );

  with filtered as materialized (
    select
      r.id,
      r.number,
      v_prefix || lpad(r.number::text, 8, '0') as display_number,
      r.created_at,
      r.total,
      r.method,
      r.status,
      r.customer_id,
      coalesce(c.full_name, concat_ws(' ', c.first_name, c.last_name)) as customer_name,
      c.code as customer_code,
      r.created_by,
      nullif(concat_ws(' ', creator.first_name, creator.last_name), '') as employee_name
    from public.receipts r
    join public.customers c on c.id = r.customer_id
    left join public.profiles creator on creator.id = r.created_by
    where (
        public.has_permission('receipts.view')
        or (r.created_by = auth.uid() and public.has_permission('receipts.view_own'))
      )
      and (p_search is null or btrim(p_search) = ''
        or r.number::text ilike '%' || btrim(p_search) || '%'
        or (v_prefix || lpad(r.number::text, 8, '0')) ilike '%' || btrim(p_search) || '%'
        or coalesce(c.full_name, concat_ws(' ', c.first_name, c.last_name)) ilike '%' || btrim(p_search) || '%'
        or c.code ilike '%' || btrim(p_search) || '%'
        or concat_ws(' ', creator.first_name, creator.last_name) ilike '%' || btrim(p_search) || '%')
      and (p_from is null or r.created_at >= p_from)
      and (p_to is null or r.created_at < p_to)
      and (p_method is null or r.method = p_method)
      and (p_status is null or r.status = p_status)
      and (p_min_amount is null or r.total >= p_min_amount)
      and (p_max_amount is null or r.total <= p_max_amount)
  ),
  summary as (
    select
      count(*) as total_count,
      count(*) filter (where status = 'paid') as paid_count,
      coalesce(sum(total) filter (where status = 'paid'), 0)::numeric(12, 2) as paid_total,
      count(*) filter (where status = 'voided') as voided_count
    from filtered
  ),
  page as (
    select *
    from filtered
    order by
      case when p_sort = 'created_at' and p_direction = 'asc' then created_at end asc,
      case when p_sort = 'created_at' and p_direction = 'desc' then created_at end desc,
      case when p_sort = 'number' and p_direction = 'asc' then number end asc,
      case when p_sort = 'number' and p_direction = 'desc' then number end desc,
      case when p_sort = 'customer' and p_direction = 'asc' then customer_name end asc,
      case when p_sort = 'customer' and p_direction = 'desc' then customer_name end desc,
      case when p_sort = 'employee' and p_direction = 'asc' then employee_name end asc,
      case when p_sort = 'employee' and p_direction = 'desc' then employee_name end desc,
      case when p_sort = 'total' and p_direction = 'asc' then total end asc,
      case when p_sort = 'total' and p_direction = 'desc' then total end desc,
      case when p_sort = 'status' and p_direction = 'asc' then status end asc,
      case when p_sort = 'status' and p_direction = 'desc' then status end desc,
      created_at desc,
      id
    limit p_limit offset p_offset
  )
  select
    coalesce((select jsonb_agg(to_jsonb(page)) from page), '[]'::jsonb),
    summary.total_count,
    summary.paid_count,
    summary.paid_total,
    summary.voided_count
  into v_receipts, v_total, v_paid_count, v_paid_total, v_voided_count
  from summary;

  return jsonb_build_object(
    'rows', v_receipts,
    'total_count', v_total,
    'paid_count', v_paid_count,
    'paid_total', v_paid_total,
    'voided_count', v_voided_count
  );
end;
$$;

create or replace function public.get_receipt_browser_detail(p_receipt uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
  v_prefix text;
begin
  if not coalesce(public.has_permission('receipts.view'), false)
     and not coalesce(public.has_permission('receipts.view_own'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  v_prefix := coalesce(
    (select s.value #>> '{}' from public.settings s where s.key = 'ops.receipt_prefix'),
    'R-'
  );

  select jsonb_build_object(
    'id', r.id,
    'number', r.number,
    'display_number', v_prefix || lpad(r.number::text, 8, '0'),
    'customer_id', r.customer_id,
    'customer_name', coalesce(c.full_name, concat_ws(' ', c.first_name, c.last_name)),
    'customer_code', c.code,
    'total', r.total,
    'subtotal', r.subtotal,
    'discount', r.discount,
    'service_charge', r.service_charge,
    'tax', r.tax,
    'method', r.method,
    'status', r.status,
    'amount_received', r.amount_received,
    'note', r.note,
    'created_by', r.created_by,
    'employee_name', nullif(concat_ws(' ', creator.first_name, creator.last_name), ''),
    'created_at', r.created_at,
    'voided_by', r.voided_by,
    'voided_by_name', nullif(concat_ws(' ', voider.first_name, voider.last_name), ''),
    'voided_at', r.voided_at,
    'void_reason', r.void_reason,
    'shift', case when shift.id is null then null else jsonb_build_object(
      'id', shift.id,
      'opened_at', shift.opened_at,
      'closed_at', shift.closed_at,
      'opening_cash', shift.opening_cash,
      'closing_cash', shift.closing_cash,
      'note', shift.note
    ) end,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', line.id,
        'line_type', line.line_type,
        'order_id', line.order_id,
        'fee_id', line.fee_id,
        'description', line.description,
        'amount', line.amount
      ) order by line.id)
      from public.receipt_lines line
      where line.receipt_id = r.id
    ), '[]'::jsonb)
  )
  into v_result
  from public.receipts r
  join public.customers c on c.id = r.customer_id
  left join public.profiles creator on creator.id = r.created_by
  left join public.profiles voider on voider.id = r.voided_by
  left join public.shift_sessions shift on shift.id = r.shift_session_id
  where r.id = p_receipt
    and (
      public.has_permission('receipts.view')
      or (r.created_by = auth.uid() and public.has_permission('receipts.view_own'))
    );

  if v_result is null then
    raise exception using errcode = 'P0002', message = 'receipt not found';
  end if;
  return v_result;
end;
$$;

revoke all on function public.list_receipts_browser(
  text, timestamptz, timestamptz, text, text, numeric, numeric,
  text, text, integer, integer
) from public, anon;
revoke all on function public.get_receipt_browser_detail(uuid)
  from public, anon;
grant execute on function public.list_receipts_browser(
  text, timestamptz, timestamptz, text, text, numeric, numeric,
  text, text, integer, integer
) to authenticated;
grant execute on function public.get_receipt_browser_detail(uuid)
  to authenticated;

commit;
