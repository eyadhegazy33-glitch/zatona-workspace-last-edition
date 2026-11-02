do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.checkins'::regclass
      and confrelid = 'public.resources'::regclass
      and contype = 'f'
  loop
    execute format(
      'alter table public.checkins drop constraint %I',
      v_constraint.conname
    );
  end loop;
end
$$;

alter table public.checkins
  add constraint checkins_resource_id_fkey
  foreign key (resource_id)
  references public.resources(id)
  on delete set null;

create or replace function public.delete_resource(p_resource uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('resources.manage') then
    raise exception 'not allowed';
  end if;

  perform 1
  from public.resources
  where id = p_resource
  for update;

  if not found then
    raise exception 'resource not found';
  end if;

  if exists (
    select 1
    from public.checkins
    where resource_id = p_resource
      and checked_out_at is null
  ) then
    raise exception 'resource occupied';
  end if;

  delete from public.resources
  where id = p_resource;
end;
$$;

revoke execute on function public.delete_resource(uuid) from public, anon;
grant execute on function public.delete_resource(uuid) to authenticated;
