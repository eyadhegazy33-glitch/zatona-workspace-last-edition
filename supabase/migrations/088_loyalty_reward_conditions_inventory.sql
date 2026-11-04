begin;

alter table public.inventory_items
  alter column qty type numeric(14, 4)
  using qty::numeric(14, 4);

alter table public.inventory_movements
  alter column change type numeric(14, 4)
  using change::numeric(14, 4),
  alter column qty_after type numeric(14, 4)
  using qty_after::numeric(14, 4),
  add column if not exists qty_before numeric(14, 4),
  add column if not exists notes text,
  add column if not exists order_id uuid references public.pos_orders(id) on delete set null;

alter table public.loyalty_rewards
  add column starts_at date,
  add column ends_at date,
  add column minimum_checkins integer not null default 0
    check (minimum_checkins between 0 and 1000000),
  add column inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  add column inventory_quantity numeric(14, 4),
  add constraint loyalty_reward_date_range
    check (starts_at is null or ends_at is null or starts_at <= ends_at),
  add constraint loyalty_reward_inventory_quantity
    check (
      (inventory_item_id is null and inventory_quantity is null)
      or (
        inventory_item_id is not null
        and inventory_quantity is not null
        and inventory_quantity > 0
        and inventory_quantity = round(inventory_quantity, 4)
      )
    );

alter table public.loyalty_redemptions
  add column reserved_inventory_item_id uuid
    references public.inventory_items(id) on delete restrict,
  add column reserved_inventory_quantity numeric(14, 4)
    check (reserved_inventory_quantity is null or reserved_inventory_quantity > 0);

create or replace function public.save_loyalty_reward_config(
  p_id uuid,
  p_name_en text,
  p_name_ar text,
  p_description_en text,
  p_description_ar text,
  p_points_cost integer,
  p_stock_remaining integer,
  p_is_active boolean,
  p_sort_order integer,
  p_starts_at date,
  p_ends_at date,
  p_minimum_checkins integer,
  p_inventory_item uuid,
  p_inventory_quantity numeric
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if not coalesce(public.has_permission('loyalty.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_name_en is null or length(btrim(p_name_en)) not between 1 and 100
     or p_name_ar is null or length(btrim(p_name_ar)) not between 1 and 100
     or length(coalesce(p_description_en, '')) > 500
     or length(coalesce(p_description_ar, '')) > 500
     or p_points_cost is null or p_points_cost not between 1 and 100000000
     or (p_stock_remaining is not null and p_stock_remaining < 0)
     or p_sort_order is null or p_sort_order not between -100000 and 100000
     or p_is_active is null
     or (p_starts_at is not null and p_ends_at is not null and p_starts_at > p_ends_at)
     or p_minimum_checkins is null or p_minimum_checkins not between 0 and 1000000
     or (
       (p_inventory_item is null and p_inventory_quantity is not null)
       or (p_inventory_item is not null and (
         p_inventory_quantity is null
         or p_inventory_quantity <= 0
         or p_inventory_quantity <> round(p_inventory_quantity, 4)
       ))
     ) then
    raise exception using errcode = '22023', message = 'invalid reward details';
  end if;

  if p_inventory_item is not null and not exists (
    select 1 from public.inventory_items
    where id = p_inventory_item and active
  ) then
    raise exception using errcode = 'P0002', message = 'reward inventory item is unavailable';
  end if;

  if p_id is null then
    insert into public.loyalty_rewards (
      name_en, name_ar, description_en, description_ar,
      points_cost, stock_remaining, is_active, sort_order, created_by,
      starts_at, ends_at, minimum_checkins, inventory_item_id, inventory_quantity
    )
    values (
      btrim(p_name_en), btrim(p_name_ar), coalesce(p_description_en, ''),
      coalesce(p_description_ar, ''), p_points_cost, p_stock_remaining,
      p_is_active, p_sort_order, auth.uid(),
      p_starts_at, p_ends_at, p_minimum_checkins,
      p_inventory_item, p_inventory_quantity
    )
    returning id into v_id;
  else
    update public.loyalty_rewards
    set name_en = btrim(p_name_en),
        name_ar = btrim(p_name_ar),
        description_en = coalesce(p_description_en, ''),
        description_ar = coalesce(p_description_ar, ''),
        points_cost = p_points_cost,
        stock_remaining = p_stock_remaining,
        is_active = p_is_active,
        sort_order = p_sort_order,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        minimum_checkins = p_minimum_checkins,
        inventory_item_id = p_inventory_item,
        inventory_quantity = p_inventory_quantity,
        updated_at = now()
    where id = p_id and deleted_at is null
    returning id into v_id;
    if v_id is null then
      raise exception using errcode = 'P0002', message = 'reward not found';
    end if;
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'loyalty.reward.save', 'loyalty_reward', v_id::text,
    jsonb_build_object(
      'name_en', btrim(p_name_en),
      'points_cost', p_points_cost,
      'is_active', p_is_active,
      'stock_remaining', p_stock_remaining,
      'starts_at', p_starts_at,
      'ends_at', p_ends_at,
      'minimum_checkins', p_minimum_checkins,
      'inventory_item_id', p_inventory_item,
      'inventory_quantity', p_inventory_quantity
    )
  );
  return v_id;
end;
$$;

create or replace function public.get_customer_loyalty_portal(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_customer uuid;
  v_customer_points bigint;
  v_customer_checkins bigint;
  v_result jsonb;
begin
  v_customer := public.assert_customer_loyalty_session(p_token);

  select coalesce(sum(ledger.points), 0)
  into v_customer_points
  from public.loyalty_points_ledger ledger
  where ledger.customer_id = v_customer;

  select count(*)
  into v_customer_checkins
  from public.checkins checkin
  where checkin.customer_id = v_customer;

  select jsonb_build_object(
    'customer', jsonb_build_object(
      'id', customer.id,
      'code', customer.code,
      'name', customer.full_name
    ),
    'points', v_customer_points,
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
        'sort_order', reward.sort_order,
        'starts_at', reward.starts_at,
        'ends_at', reward.ends_at,
        'minimum_checkins', reward.minimum_checkins,
        'customer_checkins', v_customer_checkins,
        'inventory_item_id', reward.inventory_item_id,
        'inventory_item_name', inventory.name,
        'inventory_unit', inventory.unit,
        'inventory_quantity', reward.inventory_quantity,
        'inventory_remaining', inventory.qty,
        'can_redeem', (
          (reward.starts_at is null or reward.starts_at <= current_date)
          and (reward.ends_at is null or reward.ends_at >= current_date)
          and v_customer_checkins >= reward.minimum_checkins
          and (reward.stock_remaining is null or reward.stock_remaining > 0)
          and (
            reward.inventory_item_id is null
            or (
              inventory.active
              and inventory.qty >= reward.inventory_quantity
            )
          )
          and v_customer_points >= reward.points_cost
        ),
        'availability_reason', case
          when reward.starts_at is not null and reward.starts_at > current_date then 'not_started'
          when reward.ends_at is not null and reward.ends_at < current_date then 'expired'
          when v_customer_checkins < reward.minimum_checkins then 'visits_required'
          when reward.stock_remaining is not null and reward.stock_remaining < 1 then 'out_of_stock'
          when reward.inventory_item_id is not null and (
            inventory.id is null or not inventory.active
            or inventory.qty < reward.inventory_quantity
          ) then 'out_of_stock'
          when v_customer_points < reward.points_cost then 'points_required'
          else 'available'
        end
      ) order by reward.sort_order, reward.name_en)
      from public.loyalty_rewards reward
      left join public.inventory_items inventory
        on inventory.id = reward.inventory_item_id
      where reward.is_active and reward.deleted_at is null
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
        where ledger.customer_id = customer.id
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
        where customer_redemptions.customer_id = customer.id
        order by customer_redemptions.requested_at desc
        limit 20
      ) redemption
    ), '[]'::jsonb)
  )
  into v_result
  from public.customers customer
  where customer.id = v_customer and customer.deleted_at is null;

  if v_result is null then
    raise exception using errcode = '28000', message = 'customer session expired';
  end if;
  return v_result;
end;
$$;

create or replace function public.request_customer_loyalty_reward(
  p_token text,
  p_reward uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_customer uuid;
  v_reward public.loyalty_rewards;
  v_inventory public.inventory_items;
  v_balance bigint;
  v_checkins bigint;
  v_inventory_after numeric(14, 4);
  v_redemption uuid;
begin
  v_customer := public.assert_customer_loyalty_session(p_token);

  perform 1 from public.customers
  where id = v_customer and deleted_at is null and status::text <> 'blocked'
  for update;
  if not found then
    raise exception using errcode = '28000', message = 'customer session expired';
  end if;

  select * into v_reward
  from public.loyalty_rewards
  where id = p_reward and is_active and deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'reward is unavailable';
  end if;
  if (v_reward.starts_at is not null and v_reward.starts_at > current_date)
     or (v_reward.ends_at is not null and v_reward.ends_at < current_date) then
    raise exception using errcode = 'P0002', message = 'reward is outside its availability period';
  end if;

  select count(*) into v_checkins
  from public.checkins
  where customer_id = v_customer;
  if v_checkins < v_reward.minimum_checkins then
    raise exception using errcode = '22023', message = 'reward eligibility conditions are not met';
  end if;

  if v_reward.stock_remaining is not null and v_reward.stock_remaining < 1 then
    raise exception using errcode = 'P0002', message = 'reward is unavailable';
  end if;

  if v_reward.inventory_item_id is not null then
    select * into v_inventory
    from public.inventory_items
    where id = v_reward.inventory_item_id and active
    for update;
    if not found or v_inventory.qty < v_reward.inventory_quantity then
      raise exception using errcode = 'P0002', message = 'reward inventory is unavailable';
    end if;
  end if;

  select coalesce(sum(points), 0) into v_balance
  from public.loyalty_points_ledger
  where customer_id = v_customer;
  if v_balance < v_reward.points_cost then
    raise exception using errcode = '22023', message = 'not enough points';
  end if;

  insert into public.loyalty_redemptions (
    customer_id, reward_id, reward_name_en, reward_name_ar, points_cost,
    reserved_inventory_item_id, reserved_inventory_quantity
  )
  values (
    v_customer, v_reward.id, v_reward.name_en, v_reward.name_ar,
    v_reward.points_cost, v_reward.inventory_item_id, v_reward.inventory_quantity
  )
  returning id into v_redemption;

  insert into public.loyalty_points_ledger (
    customer_id, points, entry_type, redemption_id
  )
  values (
    v_customer, -v_reward.points_cost, 'redemption_reserve', v_redemption
  );

  if v_reward.stock_remaining is not null then
    update public.loyalty_rewards
    set stock_remaining = stock_remaining - 1,
        updated_at = now()
    where id = v_reward.id;
  end if;

  if v_reward.inventory_item_id is not null then
    v_inventory_after := v_inventory.qty - v_reward.inventory_quantity;
    update public.inventory_items
    set qty = v_inventory_after
    where id = v_inventory.id;

    insert into public.inventory_movements (
      item_id, change, qty_before, qty_after, reason, notes, created_by
    )
    values (
      v_inventory.id,
      -v_reward.inventory_quantity,
      v_inventory.qty,
      v_inventory_after,
      'Loyalty reward redemption',
      'Reward redemption ' || v_redemption::text || ': ' || v_reward.name_en,
      null
    );

    insert into public.audit_logs (action, entity, entity_id, new_value)
    values (
      'loyalty.redemption.inventory_deduct',
      'inventory_item',
      v_inventory.id::text,
      jsonb_build_object(
        'redemption_id', v_redemption,
        'reward_id', v_reward.id,
        'quantity', v_reward.inventory_quantity,
        'unit', v_inventory.unit,
        'qty_before', v_inventory.qty,
        'qty_after', v_inventory_after
      )
    );
  end if;
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
  v_inventory public.inventory_items;
  v_inventory_after numeric(14, 4);
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

  if p_status = 'rejected' and v_redemption.reserved_inventory_item_id is not null then
    select * into v_inventory
    from public.inventory_items
    where id = v_redemption.reserved_inventory_item_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'reserved reward inventory item was not found';
    end if;

    v_inventory_after := v_inventory.qty + v_redemption.reserved_inventory_quantity;
    update public.inventory_items
    set qty = v_inventory_after
    where id = v_inventory.id;

    insert into public.inventory_movements (
      item_id, change, qty_before, qty_after, reason, notes, created_by
    )
    values (
      v_inventory.id,
      v_redemption.reserved_inventory_quantity,
      v_inventory.qty,
      v_inventory_after,
      'Loyalty reward rejection',
      'Inventory returned for redemption ' || v_redemption.id::text,
      auth.uid()
    );

    insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
    values (
      auth.uid(),
      'loyalty.redemption.inventory_return',
      'inventory_item',
      v_inventory.id::text,
      jsonb_build_object(
        'redemption_id', v_redemption.id,
        'quantity', v_redemption.reserved_inventory_quantity,
        'unit', v_inventory.unit,
        'qty_before', v_inventory.qty,
        'qty_after', v_inventory_after
      )
    );
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
      select jsonb_agg(
        to_jsonb(reward) || jsonb_build_object(
          'inventory_item_name', inventory.name,
          'inventory_unit', inventory.unit
        )
        order by reward.sort_order, reward.name_en
      )
      from public.loyalty_rewards reward
      left join public.inventory_items inventory
        on inventory.id = reward.inventory_item_id
      where reward.deleted_at is null
    ), '[]'::jsonb),
    'inventory_items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', inventory.id,
        'name', inventory.name,
        'unit', inventory.unit,
        'qty', inventory.qty
      ) order by inventory.name)
      from public.inventory_items inventory
      where inventory.active
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
        'resolution_reason', redemption.resolution_reason,
        'reserved_inventory_item_name', inventory.name,
        'reserved_inventory_quantity', redemption.reserved_inventory_quantity,
        'reserved_inventory_unit', inventory.unit
      ) order by redemption.requested_at)
      from public.loyalty_redemptions redemption
      join public.customers customer on customer.id = redemption.customer_id
      left join public.inventory_items inventory
        on inventory.id = redemption.reserved_inventory_item_id
      where redemption.status = 'requested'
    ), '[]'::jsonb)
  )
  into v_result;
  return v_result;
end;
$$;

revoke all on function public.save_loyalty_reward_config(
  uuid, text, text, text, text, integer, integer, boolean, integer,
  date, date, integer, uuid, numeric
) from public, anon;
grant execute on function public.save_loyalty_reward_config(
  uuid, text, text, text, text, integer, integer, boolean, integer,
  date, date, integer, uuid, numeric
) to authenticated;

commit;
