begin;

create sequence if not exists public.checkout_ticket_number_seq;

create table if not exists public.pos_checkout_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_no text not null unique,
  checkin_id bigint not null references public.checkins(id),
  customer_id uuid not null references public.customers(id),
  issued_by uuid not null references public.profiles(id),
  payment_method text not null check (payment_method in ('cash', 'card', 'other')),
  currency text not null,
  total numeric(12, 2) not null check (total >= 0),
  items jsonb not null default '[]'::jsonb,
  issued_at timestamptz not null default now()
);

alter table public.pos_checkout_tickets enable row level security;
revoke all on public.pos_checkout_tickets from public, anon, authenticated;

create or replace function public.checkout_visit(
  p_checkin bigint,
  p_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_checkin public.checkins;
  v_customer public.customers;
  v_order public.pos_orders;
  v_fee public.fees;
  v_visit_fee public.visit_fees;
  v_ticket public.pos_checkout_tickets;
  v_order_lines jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_total numeric(12, 2) := 0;
  v_currency text;
  v_order_count integer := 0;
begin
  if not coalesce(public.has_permission('checkins.manage'), false)
     or not coalesce(public.has_permission('orders.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash', 'card', 'other') then
    raise exception using errcode = '22023', message = 'invalid payment method';
  end if;

  select * into v_checkin
  from public.checkins
  where id = p_checkin and checked_out_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'visit not found or already closed';
  end if;

  select * into v_customer
  from public.customers
  where id = v_checkin.customer_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'customer not found';
  end if;

  select coalesce(
    (select value #>> '{}' from public.settings where key = 'ops.currency_code'),
    (select value #>> '{}' from public.settings where key = 'ops.currency'),
    'EGP'
  ) into v_currency;

  if exists (
    select 1
    from public.pos_orders
    where checkin_id = p_checkin
      and status in ('new', 'preparing', 'ready')
  ) then
    raise exception using errcode = '55000', message = 'orders must be served before checkout';
  end if;

  perform public.accrue_fees(p_checkin);

  for v_order in
    select *
    from public.pos_orders
    where checkin_id = p_checkin and status in ('open', 'served')
    order by created_at, id
    for update
  loop
    v_order_count := v_order_count + 1;
    if v_currency <> v_order.currency then
      raise exception using errcode = '22023', message = 'checkout currency mismatch';
    end if;

    select coalesce(
      jsonb_agg(jsonb_build_object(
        'kind', 'order_item',
        'name_en', item.product_name_en,
        'name_ar', item.product_name_ar,
        'quantity', item.quantity,
        'line_total', item.line_total,
        'order_number', v_order.order_number
      ) order by item.id),
      '[]'::jsonb
    )
    into v_order_lines
    from public.pos_order_items item
    where item.order_id = v_order.id;

    v_lines := v_lines || v_order_lines;
    v_total := v_total + v_order.total;
    perform public.complete_pos_order(v_order.id, p_payment_method);
  end loop;

  for v_fee in
    select *
    from public.fees
    where customer_id = v_customer.id and status = 'due'
    order by created_at, id
    for update
  loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'kind', 'timer_fee',
      'name_en', null,
      'name_ar', null,
      'quantity', 1,
      'line_total', v_fee.amount
    ));
    v_total := v_total + v_fee.amount;
    perform public.pay_timer_fee(v_fee.id, p_payment_method);
  end loop;

  for v_visit_fee in
    select fee.*
    from public.visit_fees fee
    join public.checkins visit on visit.id = fee.checkin_id
    where visit.customer_id = v_customer.id
      and not exists (
        select 1 from public.visit_fee_waivers waiver where waiver.fee_id = fee.id
      )
      and not exists (
        select 1
        from public.pos_receipts receipt
        where receipt.fee_id = fee.id
          and not exists (
            select 1 from public.pos_receipt_voids voided where voided.receipt_id = receipt.id
          )
      )
    order by fee.created_at, fee.id
    for update of fee
  loop
    if v_currency <> v_visit_fee.currency then
      raise exception using errcode = '22023', message = 'checkout currency mismatch';
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'kind', 'visit_fee',
      'name_en', null,
      'name_ar', null,
      'quantity', 1,
      'line_total', v_visit_fee.amount
    ));
    v_total := v_total + v_visit_fee.amount;
    perform public.pay_visit_fee(v_visit_fee.id, p_payment_method);
  end loop;

  perform public.check_out(p_checkin);

  insert into public.pos_checkout_tickets (
    ticket_no, checkin_id, customer_id, issued_by, payment_method,
    currency, total, items
  )
  values (
    coalesce(
      (select value #>> '{}' from public.settings where key = 'ops.receipt_prefix'),
      'R-'
    ) || 'C' || lpad(nextval('public.checkout_ticket_number_seq')::text, 7, '0'),
    p_checkin, v_customer.id, auth.uid(), p_payment_method,
    v_currency, round(v_total, 2), v_lines
  )
  returning * into v_ticket;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(),
    'pos.checkout.pay',
    'pos_checkout_ticket',
    v_ticket.id::text,
    jsonb_build_object(
      'ticket_no', v_ticket.ticket_no,
      'total', v_ticket.total,
      'currency', v_ticket.currency,
      'payment_method', v_ticket.payment_method,
      'order_count', v_order_count
    )
  );

  return jsonb_build_object(
    'ticket_id', v_ticket.id,
    'ticket_no', v_ticket.ticket_no,
    'checkin_id', v_ticket.checkin_id,
    'customer_id', v_ticket.customer_id,
    'customer_name', coalesce(v_customer.full_name, concat_ws(' ', v_customer.first_name, v_customer.last_name)),
    'customer_code', v_customer.code,
    'payment_method', v_ticket.payment_method,
    'currency', v_ticket.currency,
    'total', v_ticket.total,
    'items', v_ticket.items,
    'issued_at', v_ticket.issued_at,
    'checked_out_at', now(),
    'server_now', now()
  );
end;
$$;

revoke all on function public.checkout_visit(bigint, text) from public, anon;
grant execute on function public.checkout_visit(bigint, text) to authenticated;

commit;
