begin;

create or replace function public.get_customer_loyalty_portal(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_customer uuid;
  v_result jsonb;
begin
  v_customer := public.assert_customer_loyalty_session(p_token);

  select jsonb_build_object(
    'customer', jsonb_build_object(
      'id', c.id,
      'code', c.code,
      'name', c.full_name
    ),
    'points', coalesce((
      select sum(ledger.points)
      from public.loyalty_points_ledger ledger
      where ledger.customer_id = c.id
    ), 0),
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', reward.id,
        'name_en', reward.name_en,
        'name_ar', reward.name_ar,
        'description_en', reward.description_en,
        'description_ar', reward.description_ar,
        'points_cost', reward.points_cost,
        'stock_remaining', reward.stock_remaining,
        'is_active', reward.is_active,
        'sort_order', reward.sort_order
      ) order by reward.sort_order, reward.name_en)
      from public.loyalty_rewards reward
      where reward.is_active
        and (reward.stock_remaining is null or reward.stock_remaining > 0)
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', history.id,
        'points', history.points,
        'entry_type', history.entry_type,
        'created_at', history.created_at
      ) order by history.created_at desc)
      from (
        select ledger.id, ledger.points, ledger.entry_type, ledger.created_at
        from public.loyalty_points_ledger ledger
        where ledger.customer_id = c.id
        order by ledger.created_at desc
        limit 30
      ) history
    ), '[]'::jsonb),
    'redemptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', redemption.id,
        'reward_name_en', redemption.reward_name_en,
        'reward_name_ar', redemption.reward_name_ar,
        'points_cost', redemption.points_cost,
        'status', redemption.status,
        'requested_at', redemption.requested_at,
        'resolution_reason', redemption.resolution_reason
      ) order by redemption.requested_at desc)
      from (
        select customer_redemptions.id, customer_redemptions.reward_name_en,
          customer_redemptions.reward_name_ar, customer_redemptions.points_cost,
          customer_redemptions.status, customer_redemptions.requested_at,
          customer_redemptions.resolution_reason
        from public.loyalty_redemptions customer_redemptions
        where customer_redemptions.customer_id = c.id
        order by customer_redemptions.requested_at desc
        limit 20
      ) redemption
    ), '[]'::jsonb)
  )
  into v_result
  from public.customers c
  where c.id = v_customer
    and c.deleted_at is null;

  if v_result is null then
    raise exception using errcode = '28000', message = 'customer session expired';
  end if;
  return v_result;
end;
$$;

commit;
