create or replace function public.assign_customer_resource(
  p_checkin bigint,
  p_resource uuid
)
returns public.checkins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin public.checkins;
  v_resource public.resources;
begin
  if not public.has_permission('checkins.manage') then
    raise exception 'not allowed';
  end if;

  select *
    into v_checkin
  from public.checkins
  where id = p_checkin
    and checked_out_at is null
  for update;

  if not found then
    raise exception 'customer is not currently checked in';
  end if;

  if p_resource is not null then
    select *
      into v_resource
    from public.resources
    where id = p_resource
      and active
    for update;

    if not found or v_resource.status <> 'available' then
      raise exception 'resource not available';
    end if;

    if (
      select count(*)
      from public.checkins
      where resource_id = p_resource
        and checked_out_at is null
        and id <> p_checkin
    ) >= v_resource.capacity then
      raise exception 'resource is full';
    end if;
  end if;

  update public.checkins
  set resource_id = p_resource
  where id = p_checkin
  returning * into v_checkin;

  return v_checkin;
end;
$$;

revoke all on function public.assign_customer_resource(bigint, uuid)
  from public, anon;
grant execute on function public.assign_customer_resource(bigint, uuid)
  to authenticated;
