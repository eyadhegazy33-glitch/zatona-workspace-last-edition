begin;

create or replace function public.check_out(p_checkin bigint)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_checkin public.checkins;
  v_due numeric(10, 2);
begin
  if not coalesce(public.has_permission('checkins.manage'), false)
     or not coalesce(public.has_permission('fees.view'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select *
  into v_checkin
  from public.checkins
  where id = p_checkin
    and checked_out_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'visit not found or already closed';
  end if;

  perform public.accrue_fees(p_checkin);

  update public.checkins
  set checked_out_at = now(),
      closed_by = auth.uid()
  where id = p_checkin
    and checked_out_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'visit not found or already closed';
  end if;

  select coalesce(sum(amount), 0)
  into v_due
  from public.fees
  where checkin_id = p_checkin
    and status = 'due';

  return jsonb_build_object(
    'customer_id', v_checkin.customer_id,
    'fees_due', v_due
  );
end;
$$;

create or replace function public.waive_visit_fee(p_fee uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_fee public.visit_fees;
begin
  if not coalesce(public.has_permission('fees.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'waiver reason required';
  end if;

  select *
  into v_fee
  from public.visit_fees
  where id = p_fee
  for update;
  if not found
     or exists (
       select 1
       from public.visit_fee_waivers
       where fee_id = p_fee
     )
     or exists (
       select 1
       from public.pos_receipts receipt
       where receipt.fee_id = p_fee
         and not exists (
           select 1
           from public.pos_receipt_voids voided
           where voided.receipt_id = receipt.id
         )
     ) then
    raise exception using errcode = 'P0002', message = 'unpaid active fee not found';
  end if;

  insert into public.visit_fee_waivers (fee_id, waived_by, reason)
  values (p_fee, auth.uid(), btrim(p_reason));

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(),
    'pos.fee.waive',
    'visit_fee',
    p_fee::text,
    jsonb_build_object('reason', btrim(p_reason))
  );
end;
$$;

create or replace function public.collect_payment(
  p_customer uuid,
  p_order_ids uuid[],
  p_fee_ids uuid[],
  p_method text,
  p_amount_received numeric default null,
  p_note text default null
)
returns public.receipts
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_receipt public.receipts;
  v_orders uuid[] := coalesce(p_order_ids, '{}'::uuid[]);
  v_fees uuid[] := coalesce(p_fee_ids, '{}'::uuid[]);
  v_order_count integer;
  v_fee_count integer;
  v_order_subtotal numeric(12, 2);
  v_order_discount numeric(12, 2);
  v_order_service numeric(12, 2);
  v_order_tax numeric(12, 2);
  v_order_total numeric(12, 2);
  v_fee_total numeric(12, 2);
  v_subtotal numeric(12, 2);
  v_total numeric(12, 2);
  v_shift uuid;
begin
  if not coalesce(public.has_permission('payments.collect'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_customer is null
     or p_method is null
     or p_method not in ('cash', 'card', 'wallet', 'other') then
    raise exception using errcode = '22023', message = 'invalid payment';
  end if;
  if cardinality(v_orders) + cardinality(v_fees) = 0
     or cardinality(v_orders) + cardinality(v_fees) > 500
     or array_position(v_orders, null) is not null
     or array_position(v_fees, null) is not null
     or cardinality(v_orders) <> (
       select count(distinct selected.order_id)
       from unnest(v_orders) as selected(order_id)
     )
     or cardinality(v_fees) <> (
       select count(distinct selected.fee_id)
       from unnest(v_fees) as selected(fee_id)
     ) then
    raise exception using errcode = '22023', message = 'invalid payment items';
  end if;
  if length(coalesce(p_note, '')) > 300 then
    raise exception using errcode = '22023', message = 'payment note is too long';
  end if;

  select session.id
  into v_shift
  from public.shift_sessions session
  where session.user_id = auth.uid()
    and session.closed_at is null
  order by session.opened_at desc
  limit 1
  for update;
  if v_shift is null
     and coalesce(public.ops_text('ops.require_open_shift', 'false'), 'false') = 'true' then
    raise exception using errcode = '55000', message = 'open a shift first';
  end if;

  perform order_row.id
  from public.orders order_row
  where order_row.id = any(v_orders)
  order by order_row.id
  for update;

  perform fee_row.id
  from public.fees fee_row
  where fee_row.id = any(v_fees)
  order by fee_row.id
  for update;

  select count(*),
         coalesce(sum(order_row.subtotal), 0),
         coalesce(sum(order_row.discount), 0),
         coalesce(sum(order_row.service_charge), 0),
         coalesce(sum(order_row.tax), 0),
         coalesce(sum(order_row.total), 0)
  into v_order_count, v_order_subtotal, v_order_discount,
       v_order_service, v_order_tax, v_order_total
  from public.orders order_row
  where order_row.id = any(v_orders)
    and order_row.customer_id = p_customer
    and order_row.status <> 'cancelled'
    and order_row.receipt_id is null;

  select count(*), coalesce(sum(fee_row.amount), 0)
  into v_fee_count, v_fee_total
  from public.fees fee_row
  where fee_row.id = any(v_fees)
    and fee_row.customer_id = p_customer
    and fee_row.status = 'due'
    and fee_row.receipt_id is null;

  if v_order_count <> cardinality(v_orders)
     or v_fee_count <> cardinality(v_fees) then
    raise exception using errcode = '55000',
      message = 'some items are not payable (already paid, cancelled, or not for this customer)';
  end if;

  v_total := v_order_total + v_fee_total;
  v_subtotal := v_order_subtotal + v_fee_total;

  if p_method = 'cash' then
    if p_amount_received is null
       or p_amount_received < v_total
       or p_amount_received > 99999999.99
       or p_amount_received <> round(p_amount_received, 2) then
      raise exception using errcode = '22023',
        message = 'amount received is invalid, has excess precision, or is less than the total';
    end if;
  end if;

  insert into public.receipts (
    customer_id, subtotal, discount, service_charge, tax, total, method,
    amount_received, shift_session_id, note, created_by
  )
  values (
    p_customer, v_subtotal, v_order_discount, v_order_service, v_order_tax,
    v_total, p_method,
    case when p_method = 'cash' then p_amount_received else null end,
    v_shift, nullif(btrim(p_note), ''), auth.uid()
  )
  returning * into v_receipt;

  insert into public.receipt_lines (
    receipt_id, line_type, order_id, description, amount
  )
  select v_receipt.id, 'order', order_row.id,
         'Order #' || order_row.number::text, order_row.total
  from public.orders order_row
  where order_row.id = any(v_orders);

  insert into public.receipt_lines (
    receipt_id, line_type, fee_id, description, amount
  )
  select v_receipt.id, 'fee', fee_row.id,
         'Overdue fee - window ' || fee_row.block_number::text, fee_row.amount
  from public.fees fee_row
  where fee_row.id = any(v_fees);

  update public.orders
  set receipt_id = v_receipt.id
  where id = any(v_orders)
    and receipt_id is null;

  update public.fees
  set status = 'paid',
      paid_at = now(),
      receipt_id = v_receipt.id
  where id = any(v_fees)
    and status = 'due'
    and receipt_id is null;

  if coalesce(public.ops_text('ops.timer_reset_on', 'order_created'), 'order_created') = 'order_paid'
     and exists (
       select 1
       from public.orders order_row
       where order_row.id = any(v_orders)
         and order_row.counts_for_minimum
     ) then
    update public.checkins
    set last_qualifying_order_at = now()
    where customer_id = p_customer
      and checked_out_at is null;
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(),
    'payment.collect',
    'receipt',
    v_receipt.id::text,
    jsonb_build_object(
      'customer_id', p_customer,
      'order_ids', to_jsonb(v_orders),
      'fee_ids', to_jsonb(v_fees),
      'total', v_total,
      'method', p_method
    )
  );

  return v_receipt;
end;
$$;

create or replace function public.void_receipt(p_receipt uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_receipt public.receipts;
begin
  if not coalesce(public.has_permission('receipts.void'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'void reason required';
  end if;

  select *
  into v_receipt
  from public.receipts
  where id = p_receipt
  for update;
  if not found or v_receipt.status <> 'paid' then
    raise exception using errcode = 'P0002', message = 'receipt not found or already voided';
  end if;

  update public.receipts
  set status = 'voided',
      voided_by = auth.uid(),
      voided_at = now(),
      void_reason = btrim(p_reason)
  where id = p_receipt;

  update public.orders
  set receipt_id = null
  where receipt_id = p_receipt;

  update public.fees
  set status = 'due',
      paid_at = null,
      receipt_id = null
  where receipt_id = p_receipt;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(),
    'receipt.void',
    'receipt',
    p_receipt::text,
    jsonb_build_object('reason', btrim(p_reason))
  );
end;
$$;

create or replace function public.prevent_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception using errcode = '55000',
    message = 'this record cannot be changed or deleted';
end;
$$;

create or replace function public.receipts_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.number is distinct from old.number
     or new.customer_id is distinct from old.customer_id
     or new.subtotal is distinct from old.subtotal
     or new.discount is distinct from old.discount
     or new.service_charge is distinct from old.service_charge
     or new.tax is distinct from old.tax
     or new.total is distinct from old.total
     or new.method is distinct from old.method
     or new.amount_received is distinct from old.amount_received
     or new.shift_session_id is distinct from old.shift_session_id
     or new.note is distinct from old.note
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000', message = 'receipt amounts cannot be changed';
  end if;
  if old.status <> 'paid'
     or new.status not in ('paid', 'voided')
     or (new.status = 'paid' and (
       new.voided_by is not null
       or new.voided_at is not null
       or new.void_reason is not null
     ))
     or (new.status = 'voided' and (
       new.voided_by is null
       or new.voided_at is null
       or new.void_reason is null
       or length(btrim(new.void_reason)) not between 3 and 500
     )) then
    raise exception using errcode = '55000', message = 'invalid receipt status change';
  end if;
  return new;
end;
$$;

drop trigger if exists receipt_lines_immutable on public.receipt_lines;
create trigger receipt_lines_immutable
before update or delete on public.receipt_lines
for each row execute function public.prevent_change();

drop trigger if exists receipts_no_delete on public.receipts;
create trigger receipts_no_delete
before delete on public.receipts
for each row execute function public.prevent_change();

drop trigger if exists receipts_guard_trg on public.receipts;
create trigger receipts_guard_trg
before update on public.receipts
for each row execute function public.receipts_guard();

alter table public.receipts enable row level security;
alter table public.receipt_lines enable row level security;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'orders',
    'order_items',
    'fees',
    'receipts',
    'receipt_lines',
    'shift_sessions',
    'shift_assignments',
    'shift_swap_requests',
    'pos_orders',
    'pos_order_items',
    'pos_receipts',
    'pos_receipt_voids',
    'visit_fees',
    'visit_fee_waivers',
    'pos_checkout_tickets'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format(
        'revoke insert, update, delete, truncate, references, trigger on table public.%I from public, anon, authenticated',
        v_table
      );
    end if;
  end loop;
end;
$$;

revoke all on sequence public.receipt_number_seq from public, anon, authenticated;

do $$
begin
  if to_regclass('public.receipt_lines_id_seq') is not null then
    revoke all on sequence public.receipt_lines_id_seq from public, anon, authenticated;
  end if;
end;
$$;

revoke all on function public.accrue_fees(bigint) from public, anon, authenticated;
revoke all on function public.run_timer_job() from public, anon, authenticated;
revoke all on function public.check_out(bigint) from public, anon;
revoke all on function public.waive_visit_fee(uuid, text) from public, anon;
revoke all on function public.collect_payment(uuid, uuid[], uuid[], text, numeric, text) from public, anon;
revoke all on function public.void_receipt(uuid, text) from public, anon;
revoke all on function public.update_pos_settings(text, integer, integer, numeric, text, numeric, numeric, integer, integer, boolean, text, boolean, text, numeric) from public, anon;
revoke all on function public.prevent_change() from public, anon, authenticated;
revoke all on function public.receipts_guard() from public, anon, authenticated;

grant execute on function public.check_out(bigint) to authenticated;
grant execute on function public.waive_visit_fee(uuid, text) to authenticated;
grant execute on function public.collect_payment(uuid, uuid[], uuid[], text, numeric, text) to authenticated;
grant execute on function public.void_receipt(uuid, text) to authenticated;
grant execute on function public.update_pos_settings(text, integer, integer, numeric, text, numeric, numeric, integer, integer, boolean, text, boolean, text, numeric) to authenticated;

commit;
