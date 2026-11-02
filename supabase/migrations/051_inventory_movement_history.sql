begin;

create or replace function public.list_inventory_movements(p_item uuid)
returns table (
  id bigint,
  created_at timestamptz,
  change numeric,
  qty_after numeric,
  reason text,
  created_by uuid,
  created_by_name text
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
         movement.qty_after,
         movement.reason,
         movement.created_by,
         nullif(concat_ws(' ', profile.first_name, profile.last_name), '')
  from public.inventory_movements movement
  left join public.profiles profile on profile.id = movement.created_by
  where movement.item_id = p_item
  order by movement.created_at desc, movement.id desc
  limit 250;
end;
$$;

revoke all on function public.list_inventory_movements(uuid) from public, anon;
grant execute on function public.list_inventory_movements(uuid) to authenticated;

commit;
