create or replace function public.dashboard_low_stock_items()
returns table (item_id uuid, name text, unit text, qty numeric, min_qty numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_permission('inventory.view') then
    raise exception 'not allowed';
  end if;
  return query
  select i.id, i.name, i.unit, i.qty, i.min_qty
  from public.inventory_items i
  where i.active and i.qty <= i.min_qty
  order by (i.min_qty - i.qty) desc, i.name
  limit 100;
end $$;

revoke execute on function public.dashboard_low_stock_items() from public, anon;
grant execute on function public.dashboard_low_stock_items() to authenticated;
