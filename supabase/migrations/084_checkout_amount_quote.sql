create or replace function public.get_checkout_quote(p_checkin bigint)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_customer uuid;
  v_currency text;
  v_order_total numeric(12, 2);
  v_timer_fee_total numeric(12, 2);
  v_visit_fee_total numeric(12, 2);
begin
  if not coalesce(public.has_permission('checkins.manage'), false)
     or not coalesce(public.has_permission('orders.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select customer_id into v_customer
  from public.checkins
  where id = p_checkin and checked_out_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'visit not found or already closed';
  end if;

  if exists (
    select 1
    from public.pos_orders
    where checkin_id = p_checkin
      and status in ('new', 'preparing', 'ready')
  ) then
    raise exception using errcode = '55000', message = 'orders must be served before checkout';
  end if;

  select coalesce(
    (select value #>> '{}' from public.settings where key = 'ops.currency_code'),
    (select value #>> '{}' from public.settings where key = 'ops.currency'),
    'EGP'
  ) into v_currency;

  perform public.accrue_fees(p_checkin);

  if exists (
    select 1
    from public.pos_orders
    where checkin_id = p_checkin
      and status in ('open', 'served')
      and currency <> v_currency
  ) or exists (
    select 1
    from public.visit_fees fee
    join public.checkins visit on visit.id = fee.checkin_id
    where visit.customer_id = v_customer
      and fee.currency <> v_currency
      and not exists (
        select 1 from public.visit_fee_waivers waiver where waiver.fee_id = fee.id
      )
      and not exists (
        select 1
        from public.pos_receipts receipt
        where receipt.fee_id = fee.id
          and not exists (
            select 1 from public.pos_receipt_voids voided
            where voided.receipt_id = receipt.id
          )
      )
  ) then
    raise exception using errcode = '22023', message = 'checkout currency mismatch';
  end if;

  select coalesce(sum(total), 0)
  into v_order_total
  from public.pos_orders
  where checkin_id = p_checkin
    and status in ('open', 'served');

  select coalesce(sum(amount), 0)
  into v_timer_fee_total
  from public.fees
  where customer_id = v_customer and status = 'due';

  select coalesce(sum(fee.amount), 0)
  into v_visit_fee_total
  from public.visit_fees fee
  join public.checkins visit on visit.id = fee.checkin_id
  where visit.customer_id = v_customer
    and not exists (
      select 1 from public.visit_fee_waivers waiver where waiver.fee_id = fee.id
    )
    and not exists (
      select 1
      from public.pos_receipts receipt
      where receipt.fee_id = fee.id
        and not exists (
          select 1 from public.pos_receipt_voids voided
          where voided.receipt_id = receipt.id
        )
    );

  return jsonb_build_object(
    'currency', v_currency,
    'total', round(v_order_total + v_timer_fee_total + v_visit_fee_total, 2)
  );
end;
$$;

revoke all on function public.get_checkout_quote(bigint) from public, anon;
grant execute on function public.get_checkout_quote(bigint) to authenticated;
