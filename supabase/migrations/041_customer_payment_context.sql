create or replace function public.get_customer_payment_context(p_customer uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_context jsonb;
begin
  if not coalesce(public.has_permission('payments.collect'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select jsonb_build_object(
    'id', customer.id,
    'full_name', customer.full_name,
    'code', customer.code,
    'checkin_id', case
      when coalesce(public.has_permission('checkins.manage'), false)
        and coalesce(public.has_permission('orders.manage'), false)
      then (
        select checkin.id
        from public.checkins checkin
        where checkin.customer_id = customer.id
          and checkin.checked_out_at is null
        order by checkin.checked_in_at desc
        limit 1
      )
      else null
    end
  )
  into v_context
  from public.customers customer
  where customer.id = p_customer
    and customer.deleted_at is null;

  if v_context is null then
    raise exception using errcode = 'P0002', message = 'customer not found';
  end if;

  return v_context;
end;
$$;

revoke all on function public.get_customer_payment_context(uuid)
  from public, anon;
grant execute on function public.get_customer_payment_context(uuid)
  to authenticated;
