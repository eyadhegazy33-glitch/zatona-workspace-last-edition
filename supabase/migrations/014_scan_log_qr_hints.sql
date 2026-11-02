create or replace function public.scan_customer(p_input text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.customers;
  v_input text := trim(coalesce(p_input, ''));
  v_input_hint text;
  v_result text;
  v_checkin public.checkins;
begin
  if not public.has_permission('scanner.use') then
    raise exception 'not allowed';
  end if;

  if length(v_input) > 512 then
    v_input := '';
  end if;

  v_input_hint := left(v_input, 4)
    || case when length(v_input) > 4 then '...' else '' end;

  select *
    into c
  from public.customers
  where deleted_at is null
    and (qr_token = v_input or upper(code) = upper(v_input))
  limit 1;

  if not found then
    insert into public.scan_logs (user_id, input_hint, result)
    values (auth.uid(), v_input_hint, 'unknown');
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  v_result := case
    when c.status = 'blocked' then 'blocked'
    when c.status = 'expired'
      or (c.expiry_date is not null and c.expiry_date < current_date)
      then 'expired'
    else 'ok'
  end;

  insert into public.scan_logs (user_id, customer_id, input_hint, result)
  values (auth.uid(), c.id, v_input_hint, v_result);

  select *
    into v_checkin
  from public.checkins
  where customer_id = c.id
    and checked_out_at is null
  order by checked_in_at desc
  limit 1;

  return jsonb_build_object(
    'ok', v_result = 'ok',
    'reason', v_result,
    'customer', jsonb_build_object(
      'id', c.id,
      'code', c.code,
      'first_name', c.first_name,
      'last_name', c.last_name,
      'birth_date', c.birth_date
    ),
    'checkin', case
      when v_checkin.id is not null then to_jsonb(v_checkin)
      else null
    end
  );
end;
$$;

revoke all on function public.scan_customer(text) from public, anon;
grant execute on function public.scan_customer(text) to authenticated;
