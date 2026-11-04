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

drop trigger if exists inventory_movements_immutable
  on public.inventory_movements;

update public.inventory_movements
set qty_before = qty_after - change
where qty_before is null;

alter table public.inventory_movements
  alter column qty_before set not null;

create trigger inventory_movements_immutable
before update or delete on public.inventory_movements
for each row execute function public.prevent_inventory_movement_change();

create or replace function public.set_inventory_movement_qty_before()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.qty_before is null then
    new.qty_before := new.qty_after - new.change;
  end if;
  return new;
end;
$$;

create or replace trigger inventory_movements_capture_qty_before
before insert on public.inventory_movements
for each row execute function public.set_inventory_movement_qty_before();

create function public.adjust_stock(
  p_item uuid,
  p_change numeric,
  p_reason text,
  p_notes text
)
returns numeric
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_item public.inventory_items;
  v_new_qty numeric(14, 4);
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not (
    coalesce(public.has_permission('inventory.adjust'), false)
    or coalesce(public.has_permission('inventory.manage'), false)
  ) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_change is null
     or p_change::text in ('NaN', 'Infinity', '-Infinity')
     or p_change = 0
     or p_change <> round(p_change, 4)
     or length(v_reason) not between 3 and 500
     or length(coalesce(p_notes, '')) > 500 then
    raise exception using errcode = '22023', message = 'valid stock change and reason required';
  end if;

  select *
  into v_item
  from public.inventory_items
  where id = p_item and active
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'item not found';
  end if;

  v_new_qty := v_item.qty + p_change;
  if v_new_qty < 0 then
    raise exception using errcode = '22023', message = 'stock cannot be negative';
  end if;

  update public.inventory_items
  set qty = v_new_qty
  where id = p_item;

  insert into public.inventory_movements (
    item_id, change, qty_before, qty_after, reason, notes, created_by
  )
  values (
    p_item, p_change, v_item.qty, v_new_qty, v_reason,
    nullif(btrim(p_notes), ''), auth.uid()
  );

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(),
    'inventory.adjust',
    'inventory_item',
    p_item::text,
    jsonb_build_object(
      'change', p_change,
      'qty_before', v_item.qty,
      'qty_after', v_new_qty,
      'reason', v_reason,
      'notes', nullif(btrim(p_notes), '')
    )
  );

  return v_new_qty;
end;
$$;

create table public.menu_item_recipes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.pos_products(id),
  instructions text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_item_recipe_instructions_length
    check (instructions is null or length(instructions) <= 2000)
);

create table public.menu_item_recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.menu_item_recipes(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id),
  quantity numeric(14, 4) not null check (quantity > 0),
  unit text not null check (unit in ('ml', 'L', 'g', 'kg', 'piece')),
  created_at timestamptz not null default now(),
  unique (recipe_id, item_id)
);

create index menu_item_recipe_ingredients_item_idx
  on public.menu_item_recipe_ingredients(item_id);

alter table public.menu_item_recipes enable row level security;
alter table public.menu_item_recipe_ingredients enable row level security;

create policy menu_item_recipes_read on public.menu_item_recipes
  for select to authenticated
  using (public.has_permission('inventory.manage'));

create policy menu_item_recipe_ingredients_read on public.menu_item_recipe_ingredients
  for select to authenticated
  using (public.has_permission('inventory.manage'));

create policy pos_products_inventory_recipe_read on public.pos_products
  for select to authenticated
  using (public.has_permission('inventory.manage'));

revoke all on public.menu_item_recipes, public.menu_item_recipe_ingredients
  from public, anon, authenticated;
grant select on public.menu_item_recipes, public.menu_item_recipe_ingredients
  to authenticated;

insert into public.settings (key, value)
values ('inventory.require_recipe_for_orders', 'false'::jsonb)
on conflict (key) do nothing;

create or replace function public.recipe_quantity_in_inventory_unit(
  p_quantity numeric,
  p_recipe_unit text,
  p_inventory_unit text
)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_recipe text := lower(btrim(coalesce(p_recipe_unit, '')));
  v_inventory text := lower(btrim(coalesce(p_inventory_unit, '')));
  v_recipe_dimension text;
  v_inventory_dimension text;
  v_recipe_factor numeric;
  v_inventory_factor numeric;
begin
  v_recipe_dimension := case
    when v_recipe = 'ml' then 'volume'
    when v_recipe in ('l', 'liter', 'liters') then 'volume'
    when v_recipe in ('g', 'kg') then 'mass'
    when v_recipe in ('piece', 'pieces', 'pc', 'pcs') then 'piece'
  end;
  v_inventory_dimension := case
    when v_inventory = 'ml' then 'volume'
    when v_inventory in ('l', 'liter', 'liters') then 'volume'
    when v_inventory in ('g', 'kg') then 'mass'
    when v_inventory in (
      'piece', 'pieces', 'pc', 'pcs', 'cup', 'cups', 'lid', 'lids',
      'unit', 'units', 'bottle', 'bottles'
    ) then 'piece'
  end;
  if v_recipe_dimension is null or v_inventory_dimension is null
     or v_recipe_dimension <> v_inventory_dimension then
    raise exception using errcode = '22023', message = 'recipe unit does not match inventory unit';
  end if;

  v_recipe_factor := case v_recipe
    when 'l' then 1000
    when 'liter' then 1000
    when 'liters' then 1000
    when 'kg' then 1000
    else 1
  end;
  v_inventory_factor := case v_inventory
    when 'l' then 1000
    when 'liter' then 1000
    when 'liters' then 1000
    when 'kg' then 1000
    else 1
  end;
  return round(p_quantity * v_recipe_factor / v_inventory_factor, 4);
end;
$$;

create or replace function public.save_menu_item_recipe(
  p_product uuid,
  p_instructions text,
  p_ingredients jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_recipe_id uuid;
  v_ingredient jsonb;
  v_item_id uuid;
  v_quantity numeric;
  v_converted numeric;
  v_unit text;
  v_product public.pos_products;
  v_item public.inventory_items;
begin
  if not coalesce(public.has_permission('inventory.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_product is null
     or p_ingredients is null
     or jsonb_typeof(p_ingredients) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'invalid recipe';
  end if;
  if jsonb_array_length(p_ingredients) not between 1 and 50
     or length(coalesce(p_instructions, '')) > 2000 then
    raise exception using errcode = '22023', message = 'invalid recipe';
  end if;

  select * into v_product
  from public.pos_products
  where id = p_product
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'menu item not found';
  end if;

  for v_ingredient in select value from jsonb_array_elements(p_ingredients)
  loop
    if jsonb_typeof(v_ingredient) is distinct from 'object'
       or nullif(v_ingredient->>'item_id', '') is null
       or nullif(v_ingredient->>'quantity', '') is null
       or nullif(v_ingredient->>'unit', '') is null then
      raise exception using errcode = '22023', message = 'invalid recipe ingredient';
    end if;
    begin
      v_item_id := (v_ingredient->>'item_id')::uuid;
      v_quantity := (v_ingredient->>'quantity')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'invalid recipe ingredient';
    end;
    v_unit := v_ingredient->>'unit';
    if v_quantity::text in ('NaN', 'Infinity', '-Infinity')
       or v_quantity <= 0 or v_quantity > 9999999999.9999
       or v_quantity <> round(v_quantity, 4)
       or v_unit not in ('ml', 'L', 'g', 'kg', 'piece')
       or (
         select count(*)
         from jsonb_array_elements(p_ingredients) prior(value)
         where prior.value->>'item_id' = v_item_id::text
       ) > 1 then
      raise exception using errcode = '22023', message = 'invalid recipe ingredient';
    end if;

    select * into v_item
    from public.inventory_items
    where id = v_item_id and active;
    if not found then
      raise exception using errcode = 'P0002', message = 'active inventory item not found';
    end if;
    v_converted := public.recipe_quantity_in_inventory_unit(
      v_quantity, v_unit, v_item.unit
    );
    if v_converted <= 0 then
      raise exception using errcode = '22023', message = 'recipe quantity is too small for inventory precision';
    end if;
  end loop;

  insert into public.menu_item_recipes (
    product_id, instructions, created_by, updated_by
  )
  values (p_product, nullif(btrim(p_instructions), ''), auth.uid(), auth.uid())
  on conflict (product_id) do update
    set instructions = excluded.instructions,
        updated_by = excluded.updated_by,
        updated_at = now()
  returning id into v_recipe_id;

  delete from public.menu_item_recipe_ingredients
  where recipe_id = v_recipe_id;

  insert into public.menu_item_recipe_ingredients (recipe_id, item_id, quantity, unit)
  select v_recipe_id,
         (ingredient.value->>'item_id')::uuid,
         (ingredient.value->>'quantity')::numeric,
         ingredient.value->>'unit'
  from jsonb_array_elements(p_ingredients) ingredient(value);

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(),
    'inventory.recipe.save',
    'menu_item_recipe',
    v_recipe_id::text,
    jsonb_build_object(
      'product_id', p_product,
      'ingredient_count', jsonb_array_length(p_ingredients)
    )
  );
  return v_recipe_id;
end;
$$;

create or replace function public.delete_menu_item_recipe(p_product uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_recipe_id uuid;
begin
  if not coalesce(public.has_permission('inventory.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if coalesce((
    select (value #>> '{}')::boolean
    from public.settings
    where key = 'inventory.require_recipe_for_orders'
  ), false) and exists (
    select 1
    from public.pos_products
    where id = p_product and active
  ) then
    raise exception using errcode = '22023', message = 'active menu item recipe is required';
  end if;

  delete from public.menu_item_recipes
  where product_id = p_product
  returning id into v_recipe_id;
  if v_recipe_id is null then
    raise exception using errcode = 'P0002', message = 'recipe not found';
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(),
    'inventory.recipe.delete',
    'menu_item_recipe',
    v_recipe_id::text,
    jsonb_build_object('product_id', p_product)
  );
end;
$$;

create or replace function public.set_inventory_recipe_requirement(p_required boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not coalesce(public.has_permission('inventory.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_required is null then
    raise exception using errcode = '22023', message = 'invalid recipe requirement';
  end if;
  if p_required and exists (
    select 1
    from public.pos_products product
    left join public.menu_item_recipes recipe on recipe.product_id = product.id
    where product.active and recipe.id is null
  ) then
    raise exception using errcode = '22023', message = 'active menu items are missing recipes';
  end if;

  insert into public.settings (key, value)
  values ('inventory.require_recipe_for_orders', to_jsonb(p_required))
  on conflict (key) do update set value = excluded.value;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(),
    'inventory.recipe_requirement',
    'inventory_settings',
    'require_recipe_for_orders',
    jsonb_build_object('required', p_required)
  );
end;
$$;

create or replace function public.get_inventory_recipe_requirement()
returns boolean
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
begin
  if not coalesce(public.has_permission('inventory.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  return coalesce((
    select (value #>> '{}')::boolean
    from public.settings
    where key = 'inventory.require_recipe_for_orders'
  ), false);
end;
$$;

create or replace function public.deduct_recipe_inventory_for_order_item()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_recipe_id uuid;
  v_order public.pos_orders;
  v_recipe record;
  v_item public.inventory_items;
  v_required numeric(14, 4);
  v_qty_after numeric(14, 4);
  v_recipe_required boolean;
begin
  select recipe.id into v_recipe_id
  from public.menu_item_recipes recipe
  where recipe.product_id = new.product_id;

  if v_recipe_id is null then
    select coalesce((setting.value #>> '{}')::boolean, false)
      into v_recipe_required
    from public.settings setting
    where setting.key = 'inventory.require_recipe_for_orders';
    if coalesce(v_recipe_required, false) then
      raise exception using errcode = '22023', message = 'menu item has no inventory recipe';
    end if;
    return new;
  end if;

  perform 1
  from public.menu_item_recipes
  where id = v_recipe_id
  for share;
  if not exists (
    select 1
    from public.menu_item_recipe_ingredients
    where recipe_id = v_recipe_id
  ) then
    raise exception using errcode = '22023', message = 'menu item recipe has no ingredients';
  end if;

  select * into v_order
  from public.pos_orders
  where id = new.order_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'order not found';
  end if;

  for v_recipe in
    select ingredient.item_id, ingredient.quantity, ingredient.unit,
           item.name, item.unit
    from public.menu_item_recipe_ingredients ingredient
    join public.inventory_items item on item.id = ingredient.item_id
    where ingredient.recipe_id = v_recipe_id
    order by ingredient.item_id
  loop
    select * into v_item
    from public.inventory_items
    where id = v_recipe.item_id and active
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'recipe inventory item is unavailable';
    end if;

    v_required := public.recipe_quantity_in_inventory_unit(
      v_recipe.quantity * new.quantity,
      v_recipe.unit,
      v_item.unit
    );
    v_qty_after := v_item.qty - v_required;
    if v_qty_after < 0 then
      raise exception using errcode = '22023',
        message = 'insufficient inventory for recipe ingredient: ' || v_item.name;
    end if;

    update public.inventory_items
    set qty = v_qty_after
    where id = v_item.id;

    insert into public.inventory_movements (
      item_id, change, qty_before, qty_after, reason, created_by, order_id
    )
    values (
      v_item.id,
      -v_required,
      v_item.qty,
      v_qty_after,
      'Order #' || v_order.id::text || ' · ' || new.product_name_en,
      v_order.created_by,
      v_order.id
    );

    insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
    values (
      v_order.created_by,
      'inventory.recipe_deduct',
      'inventory_item',
      v_item.id::text,
      jsonb_build_object(
        'order_id', v_order.id,
        'product_id', new.product_id,
        'product_name', new.product_name_en,
        'order_quantity', new.quantity,
        'ingredient_quantity', v_required,
        'unit', v_item.unit,
        'qty_before', v_item.qty,
        'qty_after', v_qty_after
      )
    );
  end loop;

  return new;
end;
$$;

create or replace trigger pos_order_items_deduct_recipe_inventory
after insert on public.pos_order_items
for each row execute function public.deduct_recipe_inventory_for_order_item();

create function public.list_inventory_movements_detailed(p_item uuid)
returns table (
  id bigint,
  created_at timestamptz,
  change numeric,
  qty_before numeric,
  qty_after numeric,
  reason text,
  notes text,
  created_by uuid,
  created_by_name text,
  order_id uuid
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
begin
  if not coalesce(public.has_permission('inventory.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_item is null or not exists (
    select 1 from public.inventory_items where inventory_items.id = p_item
  ) then
    raise exception using errcode = 'P0002', message = 'inventory item not found';
  end if;

  return query
  select movement.id,
         movement.created_at,
         movement.change,
         movement.qty_before,
         movement.qty_after,
         movement.reason,
         movement.notes,
         movement.created_by,
         nullif(concat_ws(' ', profile.first_name, profile.last_name), ''),
         movement.order_id
  from public.inventory_movements movement
  left join public.profiles profile on profile.id = movement.created_by
  where movement.item_id = p_item
  order by movement.created_at desc, movement.id desc
  limit 250;
end;
$$;

revoke all on function public.save_menu_item_recipe(uuid, text, jsonb)
  from public, anon;
revoke all on function public.adjust_stock(uuid, numeric, text, text)
  from public, anon;
revoke all on function public.delete_menu_item_recipe(uuid)
  from public, anon;
revoke all on function public.set_inventory_recipe_requirement(boolean)
  from public, anon;
revoke all on function public.get_inventory_recipe_requirement()
  from public, anon;
revoke all on function public.recipe_quantity_in_inventory_unit(numeric, text, text)
  from public, anon, authenticated;
revoke all on function public.deduct_recipe_inventory_for_order_item()
  from public, anon, authenticated;
revoke all on function public.set_inventory_movement_qty_before()
  from public, anon, authenticated;
revoke all on function public.list_inventory_movements_detailed(uuid)
  from public, anon;
grant execute on function public.save_menu_item_recipe(uuid, text, jsonb)
  to authenticated;
grant execute on function public.adjust_stock(uuid, numeric, text, text)
  to authenticated;
grant execute on function public.delete_menu_item_recipe(uuid)
  to authenticated;
grant execute on function public.set_inventory_recipe_requirement(boolean)
  to authenticated;
grant execute on function public.get_inventory_recipe_requirement()
  to authenticated;
grant execute on function public.list_inventory_movements_detailed(uuid)
  to authenticated;

commit;
