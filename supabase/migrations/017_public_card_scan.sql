-- Public QR card status checks. The QR contains a token-bearing public URL;
-- the opaque token is sent directly to this RPC and is never exposed in API reads.

create or replace function public.scan_public_card(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.customers;
  v_token text := trim(coalesce(p_token, ''));
  v_result text;
begin
  if length(v_token) < 32 or length(v_token) > 512 then
    return jsonb_build_object('ok', false, 'reason', 'unknown', 'customer', null);
  end if;

  select * into c
  from public.customers
  where deleted_at is null
    and qr_token = v_token
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown', 'customer', null);
  end if;

  v_result := case
    when c.status = 'blocked' then 'blocked'
    when c.status = 'expired'
      or (c.expiry_date is not null and c.expiry_date < current_date)
      then 'expired'
    else 'ok'
  end;

  insert into public.scan_logs (customer_id, input_hint, result)
  values (
    c.id,
    left(v_token, 4) || '...',
    v_result
  );

  -- Each public card scan is one completed visit for customer history.
  -- It is closed immediately so the active check-in remains available for
  -- reception's separate check-in workflow.
  if v_result = 'ok' then
    insert into public.checkins (
      customer_id,
      checked_in_at,
      timer_started_at,
      checked_out_at
    ) values (
      c.id,
      now(),
      now(),
      now()
    );
  end if;

  return jsonb_build_object(
    'ok', v_result = 'ok',
    'reason', v_result,
    'customer', jsonb_build_object(
      'code', c.code,
      'first_name', c.first_name,
      'last_name', c.last_name
    )
  );
end;
$$;

revoke all on function public.scan_public_card(text) from public, anon, authenticated;
grant execute on function public.scan_public_card(text) to anon;
