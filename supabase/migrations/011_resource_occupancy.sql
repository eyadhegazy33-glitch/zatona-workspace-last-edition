create or replace function public.get_resource_occupancy()
returns table (resource_id uuid, people_inside bigint)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.has_permission('resources.manage') then
    raise exception 'not allowed';
  end if;

  return query
  select c.resource_id, count(*)::bigint
  from public.checkins c
  where c.resource_id is not null
    and c.checked_out_at is null
  group by c.resource_id;
end;
$$;

revoke all on function public.get_resource_occupancy() from public, anon;
grant execute on function public.get_resource_occupancy() to authenticated;
