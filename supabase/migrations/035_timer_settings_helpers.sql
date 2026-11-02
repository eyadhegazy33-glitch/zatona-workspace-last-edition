begin;

create or replace function public.ops_num(p_key text, p_default numeric)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_value jsonb;
begin
  if p_key not in (
    'ops.timer_window_minutes',
    'ops.timer_warning_minutes',
    'ops.timer_grace_minutes',
    'ops.overdue_fee',
    'ops.service_charge_percent',
    'ops.tax_percent',
    'ops.cash_difference_alert_amount'
  ) then
    raise exception 'unsupported timer setting';
  end if;

  select value into v_value
  from public.settings
  where key = p_key;

  if not found then
    return p_default;
  end if;
  if jsonb_typeof(v_value) <> 'number' then
    raise exception 'invalid numeric timer setting: %', p_key;
  end if;

  return (v_value #>> '{}')::numeric;
end;
$$;

create or replace function public.ops_text(p_key text, p_default text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_value jsonb;
begin
  if p_key not in (
    'ops.fee_repeats',
    'ops.require_open_shift',
    'ops.timer_restart_on',
    'ops.currency_code',
    'ops.receipt_prefix',
    'ops.receipt_footer'
  ) then
    raise exception 'unsupported timer setting';
  end if;

  select value into v_value
  from public.settings
  where key = p_key;

  if not found then
    return p_default;
  end if;
  if (jsonb_typeof(v_value) = 'boolean')
     <> (p_key in ('ops.fee_repeats', 'ops.require_open_shift')) then
    raise exception 'invalid text timer setting: %', p_key;
  end if;

  return v_value #>> '{}';
end;
$$;

revoke all on function public.ops_num(text, numeric) from public, anon, authenticated;
revoke all on function public.ops_text(text, text) from public, anon, authenticated;
grant execute on function public.ops_num(text, numeric) to service_role;
grant execute on function public.ops_text(text, text) to service_role;

commit;
