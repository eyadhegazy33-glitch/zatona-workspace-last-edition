begin;

create or replace function public.get_pos_settings()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if not (
    coalesce(public.has_permission('orders.manage'), false)
    or coalesce(public.has_permission('orders.view'), false)
    or coalesce(public.has_permission('orders.create'), false)
    or coalesce(public.has_permission('products.manage'), false)
    or coalesce(public.has_permission('shifts.manage'), false)
    or coalesce(public.has_permission('checkins.manage'), false)
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select jsonb_build_object(
    'currency', coalesce(
      (select value #>> '{}' from public.settings where key = 'ops.currency_code'),
      (select value #>> '{}' from public.settings where key = 'ops.currency'),
      'EGP'
    ),
    'visit_duration_minutes', coalesce(
      (select (value #>> '{}')::integer from public.settings where key = 'ops.timer_window_minutes'),
      (select (value #>> '{}')::integer from public.settings where key = 'ops.visit_duration_minutes'),
      180
    ),
    'fee_interval_minutes', coalesce(
      (select (value #>> '{}')::integer from public.settings where key = 'ops.fee_interval_minutes'),
      30
    ),
    'fee_amount', coalesce(
      (select (value #>> '{}')::numeric from public.settings where key = 'ops.overdue_fee'),
      (select (value #>> '{}')::numeric from public.settings where key = 'ops.fee_amount'),
      0
    ),
    'timezone', coalesce(
      (select value #>> '{}' from public.settings where key = 'ops.time_zone'),
      (select value #>> '{}' from public.settings where key = 'ops.timezone'),
      'Africa/Cairo'
    ),
    'tax_percent', coalesce(
      (select (value #>> '{}')::numeric from public.settings where key = 'ops.tax_percent'),
      0
    ),
    'service_percent', coalesce(
      (select (value #>> '{}')::numeric from public.settings where key = 'ops.service_charge_percent'),
      (select (value #>> '{}')::numeric from public.settings where key = 'ops.service_percent'),
      0
    ),
    'timer_warning_minutes', coalesce(
      (select (value #>> '{}')::integer from public.settings where key = 'ops.timer_warning_minutes'),
      15
    ),
    'timer_grace_minutes', coalesce(
      (select (value #>> '{}')::integer from public.settings where key = 'ops.timer_grace_minutes'),
      0
    ),
    'fee_repeats', coalesce(
      (select (value #>> '{}')::boolean from public.settings where key = 'ops.fee_repeats'),
      true
    ),
    'timer_reset_on', coalesce(
      (select value #>> '{}' from public.settings where key = 'ops.timer_reset_on'),
      (select value #>> '{}' from public.settings where key = 'ops.timer_restart_on'),
      'order_paid'
    ),
    'require_open_shift', coalesce(
      (select (value #>> '{}')::boolean from public.settings where key = 'ops.require_open_shift'),
      false
    ),
    'receipt_prefix', coalesce(
      (select value #>> '{}' from public.settings where key = 'ops.receipt_prefix'),
      'R-'
    ),
    'cash_diff_alert', coalesce(
      (select (value #>> '{}')::numeric from public.settings where key = 'ops.cash_difference_alert_amount'),
      (select (value #>> '{}')::numeric from public.settings where key = 'ops.cash_diff_alert'),
      0
    ),
    'server_now', now()
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.update_pos_settings(
  p_currency text,
  p_visit_duration_minutes integer,
  p_fee_interval_minutes integer,
  p_fee_amount numeric,
  p_timezone text,
  p_tax_percent numeric,
  p_service_percent numeric,
  p_timer_warning_minutes integer,
  p_timer_grace_minutes integer,
  p_fee_repeats boolean,
  p_timer_reset_on text,
  p_require_open_shift boolean,
  p_receipt_prefix text,
  p_cash_diff_alert numeric
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_currency text;
begin
  if not coalesce(public.has_permission('products.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$'
     or p_visit_duration_minutes not between 10 and 1440
     or p_fee_interval_minutes not between 1 and 1440
     or p_fee_amount is null or p_fee_amount not between 0 and 99999999.99
     or p_tax_percent is null or p_tax_percent not between 0 and 100
     or p_service_percent is null or p_service_percent not between 0 and 100
     or p_timer_warning_minutes is null or p_timer_warning_minutes not between 0 and 1440
     or p_timer_grace_minutes is null or p_timer_grace_minutes not between 0 and 1440
     or p_fee_repeats is null or p_timer_reset_on is null
     or p_timer_reset_on not in ('order_created', 'order_paid')
     or p_require_open_shift is null
     or p_timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone)
     or p_receipt_prefix is null or length(p_receipt_prefix) > 20
     or p_cash_diff_alert is null or p_cash_diff_alert not between 0 and 99999999.99 then
    raise exception using errcode = '22023', message = 'invalid point-of-sale settings';
  end if;

  select value #>> '{}'
  into v_currency
  from public.settings
  where key in ('ops.currency_code', 'ops.currency')
  order by case key when 'ops.currency_code' then 0 else 1 end
  limit 1
  for update;
  if exists (select 1 from public.pos_shifts where closed_at is null)
     and p_currency is distinct from coalesce(v_currency, 'EGP') then
    raise exception using errcode = '22023', message = 'currency cannot be changed while a shift is open';
  end if;

  insert into public.settings (key, value, updated_by, updated_at)
  values
    ('ops.currency_code', to_jsonb(p_currency), auth.uid(), now()),
    ('ops.currency', to_jsonb(p_currency), auth.uid(), now()),
    ('ops.timer_window_minutes', to_jsonb(p_visit_duration_minutes), auth.uid(), now()),
    ('ops.visit_duration_minutes', to_jsonb(p_visit_duration_minutes), auth.uid(), now()),
    ('ops.fee_interval_minutes', to_jsonb(p_fee_interval_minutes), auth.uid(), now()),
    ('ops.overdue_fee', to_jsonb(round(p_fee_amount, 2)), auth.uid(), now()),
    ('ops.fee_amount', to_jsonb(round(p_fee_amount, 2)), auth.uid(), now()),
    ('ops.time_zone', to_jsonb(p_timezone), auth.uid(), now()),
    ('ops.timezone', to_jsonb(p_timezone), auth.uid(), now()),
    ('ops.tax_percent', to_jsonb(round(p_tax_percent, 2)), auth.uid(), now()),
    ('ops.service_charge_percent', to_jsonb(round(p_service_percent, 2)), auth.uid(), now()),
    ('ops.service_percent', to_jsonb(round(p_service_percent, 2)), auth.uid(), now()),
    ('ops.timer_warning_minutes', to_jsonb(p_timer_warning_minutes), auth.uid(), now()),
    ('ops.timer_grace_minutes', to_jsonb(p_timer_grace_minutes), auth.uid(), now()),
    ('ops.fee_repeats', to_jsonb(p_fee_repeats), auth.uid(), now()),
    ('ops.timer_restart_on', to_jsonb(p_timer_reset_on), auth.uid(), now()),
    ('ops.timer_reset_on', to_jsonb(p_timer_reset_on), auth.uid(), now()),
    ('ops.require_open_shift', to_jsonb(p_require_open_shift), auth.uid(), now()),
    ('ops.receipt_prefix', to_jsonb(p_receipt_prefix), auth.uid(), now()),
    ('ops.cash_difference_alert_amount', to_jsonb(round(p_cash_diff_alert, 2)), auth.uid(), now()),
    ('ops.cash_diff_alert', to_jsonb(round(p_cash_diff_alert, 2)), auth.uid(), now())
  on conflict (key) do update
  set value = excluded.value,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;

  insert into public.audit_logs (actor_id, action, entity, new_value)
  values (
    auth.uid(),
    'pos.settings.update',
    'pos_settings',
    jsonb_build_object(
      'currency', p_currency,
      'visit_duration_minutes', p_visit_duration_minutes,
      'fee_interval_minutes', p_fee_interval_minutes,
      'fee_amount', round(p_fee_amount, 2),
      'tax_percent', p_tax_percent,
      'service_percent', p_service_percent,
      'timezone', p_timezone,
      'timer_reset_on', p_timer_reset_on,
      'require_open_shift', p_require_open_shift,
      'cash_diff_alert', round(p_cash_diff_alert, 2)
    )
  );

  return public.get_pos_settings();
end;
$$;

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

  if p_key in ('ops.currency_code', 'ops.currency') then
    select value into v_old_value
    from public.settings
    where key = p_key
    for update;
    if exists (select 1 from public.pos_shifts where closed_at is null)
       and (v_new_value #>> '{}') is distinct from coalesce(v_old_value #>> '{}', 'EGP') then
      raise exception using errcode = '22023',
        message = 'currency cannot be changed while a shift is open';
    end if;
  else
    select value into v_old_value
    from public.settings
    where key = p_key
    for update;
  end if;

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
