begin;

create or replace function public.update_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_value jsonb;
  v_new_value jsonb;
  v_number numeric;
begin
  if not public.has_permission('settings.manage') then
    raise exception 'not allowed';
  end if;

  if p_key is null
     or p_key not in (
       'workspace_name', 'logo_url', 'primary_color', 'secondary_color',
       'ops.timer_window_minutes', 'ops.visit_duration_minutes',
       'ops.timer_warning_minutes', 'ops.timer_grace_minutes',
       'ops.overdue_fee', 'ops.fee_amount', 'ops.fee_interval_minutes',
       'ops.fee_repeats', 'ops.timer_restart_on', 'ops.timer_reset_on',
       'ops.service_charge_percent', 'ops.service_percent', 'ops.tax_percent',
       'ops.currency_code', 'ops.currency', 'ops.time_zone', 'ops.timezone',
       'ops.receipt_prefix', 'ops.receipt_footer', 'ops.require_open_shift',
       'ops.cash_difference_alert_amount', 'ops.cash_diff_alert'
     ) then
    raise exception 'setting key is not supported';
  end if;
  if p_value is null and p_key <> 'logo_url' then
    raise exception 'setting value is required';
  end if;

  v_new_value := coalesce(p_value, 'null'::jsonb);

  if p_key = 'workspace_name'
     and (jsonb_typeof(v_new_value) <> 'string'
       or length(btrim(v_new_value #>> '{}')) not between 1 and 80) then
    raise exception 'invalid workspace name';
  end if;
  if p_key = 'logo_url'
     and jsonb_typeof(v_new_value) not in ('string', 'null') then
    raise exception 'invalid logo URL';
  end if;
  if p_key in ('primary_color', 'secondary_color')
     and (jsonb_typeof(v_new_value) <> 'string'
       or v_new_value #>> '{}' !~ '^#[0-9A-Fa-f]{6}$') then
    raise exception 'invalid color';
  end if;

  if p_key in (
    'ops.timer_window_minutes', 'ops.visit_duration_minutes',
    'ops.timer_warning_minutes', 'ops.timer_grace_minutes',
    'ops.overdue_fee', 'ops.fee_amount', 'ops.fee_interval_minutes',
    'ops.service_charge_percent', 'ops.service_percent', 'ops.tax_percent',
    'ops.cash_difference_alert_amount', 'ops.cash_diff_alert'
  ) then
    if jsonb_typeof(v_new_value) <> 'number' then
      raise exception 'operational setting must be a number';
    end if;
    v_number := (v_new_value #>> '{}')::numeric;

    if p_key in (
      'ops.timer_window_minutes', 'ops.visit_duration_minutes',
      'ops.timer_warning_minutes', 'ops.timer_grace_minutes',
      'ops.fee_interval_minutes'
    ) and v_number <> trunc(v_number) then
      raise exception 'timer durations must be whole minutes';
    end if;
    if p_key in (
      'ops.overdue_fee', 'ops.fee_amount',
      'ops.cash_difference_alert_amount', 'ops.cash_diff_alert'
    ) and v_number <> round(v_number, 2) then
      raise exception 'amount must have at most two decimal places';
    end if;

    if p_key in ('ops.timer_window_minutes', 'ops.visit_duration_minutes')
       and v_number not between 10 and 1440 then
      raise exception 'timer window must be between 10 and 1440 minutes';
    elsif p_key in (
      'ops.timer_warning_minutes', 'ops.timer_grace_minutes',
      'ops.fee_interval_minutes'
    ) and v_number not between 0 and 1440 then
      raise exception 'timer setting must be between 0 and 1440 minutes';
    elsif p_key in (
      'ops.overdue_fee', 'ops.fee_amount',
      'ops.cash_difference_alert_amount', 'ops.cash_diff_alert'
    ) and v_number not between 0 and 99999999.99 then
      raise exception 'amount must be between 0 and 99999999.99';
    elsif p_key in (
      'ops.service_charge_percent', 'ops.service_percent', 'ops.tax_percent'
    ) and v_number not between 0 and 100 then
      raise exception 'percentage must be between 0 and 100';
    end if;
  end if;

  if p_key in ('ops.fee_repeats', 'ops.require_open_shift')
     and jsonb_typeof(v_new_value) <> 'boolean' then
    raise exception 'setting must be a boolean';
  end if;
  if p_key in ('ops.timer_restart_on', 'ops.timer_reset_on')
     and (jsonb_typeof(v_new_value) <> 'string'
       or v_new_value #>> '{}' not in ('order_created', 'order_paid')) then
    raise exception 'invalid timer restart setting';
  end if;
  if p_key in ('ops.currency_code', 'ops.currency')
     and (jsonb_typeof(v_new_value) <> 'string'
       or v_new_value #>> '{}' !~ '^[A-Z]{3}$') then
    raise exception 'currency code must be three uppercase letters';
  end if;
  if p_key in ('ops.time_zone', 'ops.timezone')
     and (jsonb_typeof(v_new_value) <> 'string'
       or not exists (
         select 1
         from pg_timezone_names
         where name = v_new_value #>> '{}'
       )) then
    raise exception 'invalid time zone';
  end if;
  if p_key = 'ops.receipt_prefix'
     and (jsonb_typeof(v_new_value) <> 'string'
       or length(v_new_value #>> '{}') > 20) then
    raise exception 'receipt prefix must be at most 20 characters';
  end if;
  if p_key = 'ops.receipt_footer'
     and (jsonb_typeof(v_new_value) <> 'string'
       or length(v_new_value #>> '{}') > 500) then
    raise exception 'receipt footer must be at most 500 characters';
  end if;

  select value into v_old_value
  from public.settings
  where key = p_key
  for update;

  insert into public.settings (key, value, updated_by, updated_at)
  values (p_key, v_new_value, auth.uid(), now())
  on conflict (key) do update
    set value = excluded.value,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  insert into public.audit_logs (
    actor_id, action, entity, entity_id, old_value, new_value
  )
  values (
    auth.uid(),
    'setting.update',
    'setting',
    p_key,
    jsonb_build_object('value', v_old_value),
    jsonb_build_object('value', v_new_value)
  );
end;
$$;

revoke all on function public.update_setting(text, jsonb) from public, anon;
grant execute on function public.update_setting(text, jsonb) to authenticated;

commit;
