begin;

insert into public.permissions (key, description) values
  ('loyalty.view', 'View customer loyalty data and redemption requests'),
  ('loyalty.redemptions.fulfill', 'Fulfill or reject customer reward redemptions'),
  ('loyalty.portal.issue', 'Issue or reset customer loyalty portal codes')
on conflict (key) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_key)
select r.id, permission.key
from public.roles r
cross join (
  values
    ('loyalty.view'),
    ('loyalty.redemptions.fulfill'),
    ('loyalty.portal.issue')
) as permission(key)
where r.name in ('Admin', 'Manager', 'owner')
on conflict (role_id, permission_key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, permission.key
from public.roles r
cross join (
  values
    ('loyalty.view'),
    ('loyalty.redemptions.fulfill'),
    ('loyalty.portal.issue')
) as permission(key)
where r.name = 'Reception'
on conflict (role_id, permission_key) do nothing;

create or replace function public.set_customer_loyalty_pin(
  p_customer uuid,
  p_pin text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  if not coalesce(
    public.has_permission('loyalty.portal.issue')
    or public.has_permission('loyalty.manage'),
    false
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{6,12}$' then
    raise exception using errcode = '22023', message = 'PIN must contain 6 to 12 digits';
  end if;
  if not exists (
    select 1 from public.customers
    where id = p_customer and deleted_at is null
  ) then
    raise exception using errcode = 'P0002', message = 'customer not found';
  end if;

  insert into public.customer_loyalty_pins (
    customer_id, pin_hash, enrolled_by, enrolled_at, last_login_at
  )
  values (
    p_customer, extensions.crypt(p_pin, extensions.gen_salt('bf', 12)),
    auth.uid(), now(), null
  )
  on conflict (customer_id) do update
  set pin_hash = excluded.pin_hash,
      enrolled_by = excluded.enrolled_by,
      enrolled_at = now(),
      last_login_at = null;

  delete from public.customer_loyalty_sessions
  where customer_id = p_customer;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(),
    'loyalty.pin.set',
    'customer',
    p_customer::text,
    jsonb_build_object('action', 'manager_verified_pin_enrollment_or_reset')
  );
end;
$$;

create or replace function public.resolve_loyalty_redemption(
  p_redemption uuid,
  p_status text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_redemption public.loyalty_redemptions;
begin
  if not coalesce(
    public.has_permission('loyalty.redemptions.fulfill')
    or public.has_permission('loyalty.manage'),
    false
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_status is null or p_status not in ('fulfilled', 'rejected')
     or length(coalesce(p_reason, '')) > 500
     or (p_status = 'rejected' and length(btrim(coalesce(p_reason, ''))) not between 3 and 500) then
    raise exception using errcode = '22023', message = 'invalid redemption resolution';
  end if;

  select * into v_redemption
  from public.loyalty_redemptions
  where id = p_redemption
  for update;
  if not found or v_redemption.status <> 'requested' then
    raise exception using errcode = 'P0002', message = 'redemption not found or already resolved';
  end if;

  update public.loyalty_redemptions
  set status = p_status,
      resolved_at = now(),
      resolved_by = auth.uid(),
      resolution_reason = case when p_status = 'rejected' then btrim(p_reason) else null end
  where id = p_redemption;

  if p_status = 'rejected' then
    insert into public.loyalty_points_ledger (
      customer_id, points, entry_type, redemption_id, actor_id, reason
    )
    values (
      v_redemption.customer_id, v_redemption.points_cost,
      'redemption_refund', v_redemption.id, auth.uid(), btrim(p_reason)
    );
    update public.loyalty_rewards
    set stock_remaining = stock_remaining + 1,
        updated_at = now()
    where id = v_redemption.reward_id
      and stock_remaining is not null;
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'loyalty.redemption.resolve', 'loyalty_redemption',
    p_redemption::text,
    jsonb_build_object('status', p_status, 'reason', nullif(btrim(coalesce(p_reason, '')), ''))
  );
end;
$$;

create or replace function public.get_loyalty_admin_data()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if not coalesce(
    public.has_permission('loyalty.view')
    or public.has_permission('loyalty.manage'),
    false
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select jsonb_build_object(
    'points_per_currency_unit',
      (select points_per_currency_unit from public.loyalty_settings where id = 1),
    'rewards', coalesce((
      select jsonb_agg(to_jsonb(reward) order by reward.sort_order, reward.name_en)
      from public.loyalty_rewards reward
      where reward.deleted_at is null
    ), '[]'::jsonb),
    'redemptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', redemption.id,
        'customer_id', redemption.customer_id,
        'customer_first_name', customer.first_name,
        'customer_name', customer.full_name,
        'customer_code', customer.code,
        'reward_id', redemption.reward_id,
        'reward_name_en', redemption.reward_name_en,
        'reward_name_ar', redemption.reward_name_ar,
        'points_cost', redemption.points_cost,
        'status', redemption.status,
        'requested_at', redemption.requested_at,
        'resolution_reason', redemption.resolution_reason
      ) order by redemption.requested_at)
      from public.loyalty_redemptions redemption
      join public.customers customer on customer.id = redemption.customer_id
      where redemption.status = 'requested'
    ), '[]'::jsonb)
  )
  into v_result;
  return v_result;
end;
$$;

revoke all on function public.set_customer_loyalty_pin(uuid, text) from public, anon;
grant execute on function public.set_customer_loyalty_pin(uuid, text) to authenticated;

revoke all on function public.resolve_loyalty_redemption(uuid, text, text) from public, anon;
grant execute on function public.resolve_loyalty_redemption(uuid, text, text) to authenticated;

revoke all on function public.get_loyalty_admin_data() from public, anon;
grant execute on function public.get_loyalty_admin_data() to authenticated;

commit;
