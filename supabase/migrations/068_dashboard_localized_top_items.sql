begin;

create or replace function public.top_items(
  p_from timestamptz,
  p_to timestamptz,
  p_limit int default 10,
  p_language text default 'en'
)
returns table (item_name text, qty numeric, revenue numeric)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.has_permission('dashboard.view') then raise exception 'not allowed'; end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'invalid range';
  end if;
  return query
  select case
           when lower(coalesce(p_language, 'en')) like 'ar%' then i.product_name_ar
           else i.product_name_en
         end,
         sum(i.quantity)::numeric,
         sum(i.line_total)::numeric
  from public.pos_order_items i
  join public.pos_orders o on o.id = i.order_id
  where o.status = 'paid' and o.created_at >= p_from and o.created_at < p_to
  group by 1
  order by 2 desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
end $$;

revoke execute on function public.top_items(timestamptz, timestamptz, int, text) from public, anon;
grant execute on function public.top_items(timestamptz, timestamptz, int, text) to authenticated;

commit;
