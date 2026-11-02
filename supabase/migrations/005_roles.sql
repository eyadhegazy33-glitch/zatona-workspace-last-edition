create or replace function public.create_role(
  p_name text,
  p_is_registrable boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_id uuid;
  v_name text := trim(p_name);
begin
  if not public.has_permission('roles.manage') then
    raise exception 'not allowed';
  end if;

  if v_name is null or length(v_name) not between 2 and 50 then
    raise exception 'invalid role name';
  end if;

  if p_is_registrable is null then
    raise exception 'registrable setting is required';
  end if;

  perform pg_advisory_xact_lock(7310051::bigint);

  if exists (select 1 from public.roles r where lower(r.name) = lower(v_name)) then
    raise exception 'role already exists';
  end if;

  insert into public.roles (name, is_registrable)
  values (v_name, p_is_registrable)
  returning id into v_role_id;

  insert into public.audit_logs (
    actor_id, action, entity, entity_id, old_value, new_value
  )
  values (
    auth.uid(),
    'role.create',
    'role',
    v_role_id::text,
    null,
    jsonb_build_object(
      'name', v_name,
      'is_system', false,
      'is_registrable', p_is_registrable
    )
  );

  return v_role_id;
end;
$$;

create or replace function public.rename_role(p_role uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.roles%rowtype;
  v_name text := trim(p_name);
begin
  if not public.has_permission('roles.manage') then
    raise exception 'not allowed';
  end if;

  if v_name is null or length(v_name) not between 2 and 50 then
    raise exception 'invalid role name';
  end if;

  perform pg_advisory_xact_lock(7310051::bigint);

  select * into v_role
  from public.roles
  where id = p_role
  for update;

  if not found then
    raise exception 'role not found';
  end if;

  if v_role.is_system then
    raise exception 'system role cannot be renamed';
  end if;

  if exists (
    select 1 from public.roles r
    where lower(r.name) = lower(v_name) and r.id <> p_role
  ) then
    raise exception 'role already exists';
  end if;

  update public.roles set name = v_name where id = p_role;

  insert into public.audit_logs (
    actor_id, action, entity, entity_id, old_value, new_value
  )
  values (
    auth.uid(),
    'role.rename',
    'role',
    p_role::text,
    jsonb_build_object('name', v_role.name),
    jsonb_build_object('name', v_name)
  );
end;
$$;

create or replace function public.delete_role(p_role uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.roles%rowtype;
begin
  if not public.has_permission('roles.manage') then
    raise exception 'not allowed';
  end if;

  select * into v_role
  from public.roles
  where id = p_role
  for update;

  if not found then
    raise exception 'role not found';
  end if;

  if v_role.is_system then
    raise exception 'system role cannot be deleted';
  end if;

  if exists (
    select 1
    from public.profiles p
    where p.role_id = p_role or p.requested_role_id = p_role
  ) then
    raise exception 'role still has users';
  end if;

  insert into public.audit_logs (
    actor_id, action, entity, entity_id, old_value, new_value
  )
  values (
    auth.uid(),
    'role.delete',
    'role',
    p_role::text,
    jsonb_build_object(
      'name', v_role.name,
      'is_system', v_role.is_system,
      'is_registrable', v_role.is_registrable
    ),
    null
  );

  delete from public.roles where id = p_role;
end;
$$;

create or replace function public.set_role_permissions(
  p_role uuid,
  p_permissions text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.roles%rowtype;
  v_old_permissions text[];
  v_new_permissions text[];
  v_caller_is_admin boolean;
begin
  if not public.has_permission('roles.manage') then
    raise exception 'not allowed';
  end if;

  if p_permissions is null or array_position(p_permissions, null) is not null then
    raise exception 'permission list cannot be null';
  end if;

  select * into v_role
  from public.roles
  where id = p_role
  for update;

  if not found then
    raise exception 'role not found';
  end if;

  if exists (
    select 1
    from unnest(p_permissions) requested(permission_key)
    left join public.permissions permission
      on permission.key = requested.permission_key
    where permission.key is null
  ) then
    raise exception 'unknown permission';
  end if;

  select coalesce(array_agg(rp.permission_key order by rp.permission_key), '{}')
    into v_old_permissions
  from public.role_permissions rp
  where rp.role_id = p_role;

  select coalesce(array_agg(distinct requested.permission_key order by requested.permission_key), '{}')
    into v_new_permissions
  from unnest(p_permissions) requested(permission_key);

  if v_role.name <> 'Admin'
     and 'roles.manage' = any(v_new_permissions) then
    select exists (
      select 1
      from public.profiles p
      join public.roles r on r.id = p.role_id
      where p.id = auth.uid()
        and p.status = 'active'
        and p.deleted_at is null
        and r.name = 'Admin'
    ) into v_caller_is_admin;

    if not v_caller_is_admin then
      raise exception 'roles.manage may only be assigned by Admin';
    end if;
  end if;

  delete from public.role_permissions rp
  where rp.role_id = p_role
    and not (rp.permission_key = any(v_new_permissions));

  insert into public.role_permissions (role_id, permission_key)
  select p_role, permission_key
  from unnest(v_new_permissions) as requested(permission_key)
  on conflict (role_id, permission_key) do nothing;

  insert into public.audit_logs (
    actor_id, action, entity, entity_id, old_value, new_value
  )
  values (
    auth.uid(),
    'role.permissions.update',
    'role',
    p_role::text,
    jsonb_build_object('permissions', v_old_permissions),
    jsonb_build_object('permissions', v_new_permissions)
  );
end;
$$;

create or replace function public.set_role_registrable(
  p_role uuid,
  p_is_registrable boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.roles%rowtype;
begin
  if not public.has_permission('roles.manage') then
    raise exception 'not allowed';
  end if;

  if p_is_registrable is null then
    raise exception 'registrable setting is required';
  end if;

  select * into v_role
  from public.roles
  where id = p_role
  for update;

  if not found then
    raise exception 'role not found';
  end if;

  if v_role.is_system and p_is_registrable then
    raise exception 'system role cannot be registrable';
  end if;

  update public.roles
  set is_registrable = p_is_registrable
  where id = p_role;

  insert into public.audit_logs (
    actor_id, action, entity, entity_id, old_value, new_value
  )
  values (
    auth.uid(),
    'role.registrable.update',
    'role',
    p_role::text,
    jsonb_build_object('is_registrable', v_role.is_registrable),
    jsonb_build_object('is_registrable', p_is_registrable)
  );
end;
$$;

revoke all on function public.create_role(text, boolean) from public, anon;
revoke all on function public.rename_role(uuid, text) from public, anon;
revoke all on function public.delete_role(uuid) from public, anon;
revoke all on function public.set_role_permissions(uuid, text[]) from public, anon;
revoke all on function public.set_role_registrable(uuid, boolean) from public, anon;

grant execute on function public.create_role(text, boolean) to authenticated;
grant execute on function public.rename_role(uuid, text) to authenticated;
grant execute on function public.delete_role(uuid) to authenticated;
grant execute on function public.set_role_permissions(uuid, text[]) to authenticated;
grant execute on function public.set_role_registrable(uuid, boolean) to authenticated;
