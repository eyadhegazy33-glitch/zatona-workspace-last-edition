begin;

alter table public.bookings
  alter column resource_id drop not null;

alter table public.bookings
  drop constraint if exists bookings_resource_id_fkey;

alter table public.bookings
  add constraint bookings_resource_id_fkey
  foreign key (resource_id)
  references public.resources(id)
  on delete set null;

create or replace function public.delete_resource(p_resource uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not coalesce(public.has_permission('resources.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  perform 1
  from public.resources
  where id = p_resource
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'resource not found';
  end if;

  if exists (
    select 1
    from public.checkins
    where resource_id = p_resource
      and checked_out_at is null
  ) then
    raise exception using errcode = '23514', message = 'resource occupied';
  end if;

  if exists (
    select 1
    from public.bookings
    where resource_id = p_resource
      and status in ('pending', 'confirmed', 'checked_in')
  ) then
    raise exception using errcode = '23514', message = 'resource has active bookings';
  end if;

  update public.checkins
  set resource_id = null
  where resource_id = p_resource;

  delete from public.resources
  where id = p_resource;
end;
$$;

create or replace function public.list_bookings(
  p_from timestamptz,
  p_to timestamptz,
  p_resource uuid default null,
  p_status text default null,
  p_search text default null
)
returns table (
  id uuid,
  customer_id uuid,
  customer_name text,
  customer_code text,
  resource_id uuid,
  resource_name text,
  resource_type text,
  resource_capacity integer,
  starts_at timestamptz,
  ends_at timestamptz,
  people integer,
  notes text,
  deposit numeric,
  status text,
  cancel_reason text,
  created_by uuid,
  created_at timestamptz
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
begin
  if not coalesce(public.has_permission('bookings.view'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception using errcode = '22023', message = 'valid date range required';
  end if;
  if p_status is not null and p_status not in (
    'pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show'
  ) then
    raise exception using errcode = '22023', message = 'invalid status';
  end if;

  return query
  select booking.id,
         booking.customer_id,
         concat_ws(' ', customer.first_name, customer.last_name),
         customer.code,
         booking.resource_id,
         resource.name,
         resource.type,
         resource.capacity,
         booking.starts_at,
         booking.ends_at,
         booking.people,
         booking.notes,
         booking.deposit,
         booking.status,
         booking.cancel_reason,
         booking.created_by,
         booking.created_at
  from public.bookings booking
  join public.customers customer on customer.id = booking.customer_id
  left join public.resources resource on resource.id = booking.resource_id
  where booking.starts_at < p_to
    and booking.ends_at > p_from
    and (p_resource is null or booking.resource_id = p_resource)
    and (p_status is null or booking.status = p_status)
    and (
      nullif(btrim(p_search), '') is null
      or customer.code ilike '%' || btrim(p_search) || '%'
      or customer.first_name ilike '%' || btrim(p_search) || '%'
      or customer.last_name ilike '%' || btrim(p_search) || '%'
      or concat_ws(' ', customer.first_name, customer.last_name) ilike '%' || btrim(p_search) || '%'
    )
  order by booking.starts_at, resource.type, resource.name
  limit 5000;
end;
$$;

revoke all on function public.delete_resource(uuid) from public, anon;
grant execute on function public.delete_resource(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
