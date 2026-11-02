begin;

alter table public.loyalty_rewards
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles(id);

create or replace function public.delete_loyalty_reward(p_reward uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name text;
begin
  if not coalesce(public.has_permission('loyalty.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  update public.loyalty_rewards
  set is_active = false,
      deleted_at = now(),
      deleted_by = auth.uid(),
      updated_at = now()
  where id = p_reward
    and deleted_at is null
  returning name_en into v_name;

  if not found then
    raise exception using errcode = 'P0002', message = 'reward not found';
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(),
    'loyalty.reward.delete',
    'loyalty_reward',
    p_reward::text,
    jsonb_build_object('name_en', v_name, 'deleted_at', now())
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
  if not coalesce(public.has_permission('loyalty.manage'), false) then
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

revoke all on function public.delete_loyalty_reward(uuid)
  from public, anon;
grant execute on function public.delete_loyalty_reward(uuid)
  to authenticated;

commit;
