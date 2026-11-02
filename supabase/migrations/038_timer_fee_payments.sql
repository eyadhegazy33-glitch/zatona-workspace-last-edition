begin;

alter table public.pos_receipts
  add column if not exists timer_fee_id uuid references public.fees(id);

alter table public.pos_receipts
  drop constraint if exists pos_receipts_exactly_one_source;
alter table public.pos_receipts
  add constraint pos_receipts_exactly_one_source check (
    (order_id is not null and fee_id is null and timer_fee_id is null)
    or (order_id is null and fee_id is not null and timer_fee_id is null)
    or (order_id is null and fee_id is null and timer_fee_id is not null)
  );
create or replace function public.list_timer_fees()
returns setof jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
begin
  if not (
    coalesce(public.has_permission('fees.view'), false)
    or coalesce(public.has_permission('fees.waive'), false)
    or coalesce(public.has_permission('orders.manage'), false)
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  return query
  select jsonb_build_object(
    'id', f.id,
    'checkin_id', f.checkin_id,
    'customer_id', f.customer_id,
    'amount', f.amount,
    'currency', coalesce(
      (select value #>> '{}' from public.settings where key = 'ops.currency_code'),
      (select value #>> '{}' from public.settings where key = 'ops.currency'),
      'EGP'
    ),
    'created_at', f.created_at,
    'customer_name', c.full_name,
    'customer_code', c.code,
    'waived', f.status = 'waived',
    'paid', f.status = 'paid',
    'timer_fee', true
  )
  from public.fees f
  join public.checkins k on k.id = f.checkin_id
  join public.customers c on c.id = f.customer_id
  order by f.created_at desc
  limit 500;
end;
$$;

create or replace function public.pay_timer_fee(
  p_fee uuid,
  p_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_fee public.fees;
  v_shift public.pos_shifts;
  v_receipt public.pos_receipts;
  v_currency text;
begin
  if not coalesce(public.has_permission('orders.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash', 'card', 'other') then
    raise exception using errcode = '22023', message = 'invalid payment method';
  end if;

  select * into v_fee
  from public.fees
  where id = p_fee and status = 'due'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'unpaid active fee not found';
  end if;

  select * into v_shift
  from public.pos_shifts
  where user_id = auth.uid() and closed_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'open shift required';
  end if;

  select coalesce(
    (select value #>> '{}' from public.settings where key = 'ops.currency_code'),
    (select value #>> '{}' from public.settings where key = 'ops.currency'),
    'EGP'
  ) into v_currency;

  insert into public.pos_receipts (
    receipt_no, timer_fee_id, shift_id, issued_by, payment_method, currency, total
  )
  values (
    coalesce(
      (select value #>> '{}' from public.settings where key = 'ops.receipt_prefix'),
      'R-'
    ) || lpad(nextval('public.receipt_number_seq')::text, 8, '0'),
    v_fee.id, v_shift.id, auth.uid(), p_payment_method, v_currency, v_fee.amount
  )
  returning * into v_receipt;

  update public.fees
  set status = 'paid',
      paid_at = now()
  where id = v_fee.id;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(),
    'pos.timer_fee.pay',
    'fee',
    v_fee.id::text,
    jsonb_build_object(
      'receipt_no', v_receipt.receipt_no,
      'amount', v_receipt.total,
      'currency', v_receipt.currency,
      'payment_method', p_payment_method
    )
  );

  return jsonb_build_object(
    'receipt_id', v_receipt.id,
    'receipt_no', v_receipt.receipt_no,
    'total', v_receipt.total,
    'currency', v_receipt.currency,
    'payment_method', v_receipt.payment_method,
    'server_now', now()
  );
end;
$$;

create or replace function public.restore_timer_fee_when_receipt_voided()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.fees f
  set status = 'due',
      paid_at = null
  from public.pos_receipts r
  where r.id = new.receipt_id
    and r.timer_fee_id = f.id
    and f.status = 'paid';
  return new;
end;
$$;

drop trigger if exists restore_timer_fee_after_receipt_void
  on public.pos_receipt_voids;
create trigger restore_timer_fee_after_receipt_void
after insert on public.pos_receipt_voids
for each row execute function public.restore_timer_fee_when_receipt_voided();

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
    'voided', exists (
      select 1 from public.pos_receipt_voids v where v.receipt_id = r.id
    ),
    'void_reason', (
      select v.reason from public.pos_receipt_voids v where v.receipt_id = r.id
    ),
    'customer_name', coalesce(c.full_name, c2.full_name, c3.full_name),
    'customer_code', coalesce(c.code, c2.code, c3.code)
  )
  from public.pos_receipts r
  left join public.pos_orders o on o.id = r.order_id
  left join public.customers c on c.id = o.customer_id
  left join public.visit_fees vf on vf.id = r.fee_id
  left join public.checkins vk on vk.id = vf.checkin_id
  left join public.customers c2 on c2.id = vk.customer_id
  left join public.fees tf on tf.id = r.timer_fee_id
  left join public.customers c3 on c3.id = tf.customer_id
  order by r.issued_at desc
  limit 200;
end;
$$;

revoke all on function public.list_timer_fees() from public, anon;
revoke all on function public.pay_timer_fee(uuid, text) from public, anon;
grant execute on function public.list_timer_fees() to authenticated;
grant execute on function public.pay_timer_fee(uuid, text) to authenticated;

commit;
