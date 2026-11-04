begin;

select plan(9);

select is(
  public.recipe_quantity_in_inventory_unit(150, 'ml', 'L'),
  0.15::numeric,
  'volume recipe quantities convert to the inventory unit'
);

select is(
  public.recipe_quantity_in_inventory_unit(18, 'g', 'kg'),
  0.018::numeric,
  'mass recipe quantities convert to the inventory unit'
);

select is(
  public.recipe_quantity_in_inventory_unit(5, 'piece', 'cups'),
  5::numeric,
  'countable inventory units support recipe pieces'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgname = 'pos_order_items_deduct_recipe_inventory'
      and tgrelid = 'public.pos_order_items'::regclass
      and not tgisinternal
      and tgenabled <> 'D'
  ),
  'order item inserts invoke the inventory deduction trigger'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgname = 'inventory_movements_capture_qty_before'
      and tgrelid = 'public.inventory_movements'::regclass
      and not tgisinternal
      and tgenabled <> 'D'
  ),
  'all stock movements capture their previous quantity'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.save_menu_item_recipe(uuid,text,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.save_menu_item_recipe(uuid,text,jsonb)',
    'execute'
  ),
  'only authenticated users can call the recipe save function'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_movements'
      and column_name = 'qty_before'
      and is_nullable = 'NO'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_movements'
      and column_name = 'order_id'
  ),
  'inventory history records the before quantity and related order'
);

select ok(
  (select numeric_scale = 4
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'inventory_items'
     and column_name = 'qty'),
  'inventory quantities support precise recipe deductions'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.adjust_stock(uuid,numeric,text,text)',
    'execute'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_movements'
      and column_name = 'notes'
  ),
  'manual adjustments accept optional notes'
);

select * from finish();
rollback;
