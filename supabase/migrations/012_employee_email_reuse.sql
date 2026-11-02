create or replace function public.soft_delete_employee(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.profiles%rowtype;
  v_role_is_system boolean;
  v_remaining_admins bigint;
  v_released_email text;
begin
  if not public.has_permission('employees.manage') then
    raise exception 'not allowed';
  end if;

  if p_user = auth.uid() then
    raise exception 'cannot delete yourself';
  end if;

  perform pg_advisory_xact_lock(7310042::bigint);

  select * into v_old
  from public.profiles
  where id = p_user and deleted_at is null
  for update;

  if not found then
    raise exception 'employee not found';
  end if;

  if v_old.role_id is null or v_old.status not in ('active', 'suspended') then
    raise exception 'employee not found';
  end if;

  select (coalesce(r.is_system, false) or r.name = 'Admin')
    into v_role_is_system
  from public.roles r
  where r.id = v_old.role_id;
  v_role_is_system := coalesce(v_role_is_system, false);

  if v_role_is_system and not public.has_permission('roles.manage') then
    raise exception 'not allowed to manage an Admin';
  end if;

  if v_old.status = 'active'
     and exists (
       select 1 from public.roles r
       where r.id = v_old.role_id and r.name = 'Admin'
     ) then
    select count(*) into v_remaining_admins
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.status = 'active'
      and p.deleted_at is null
      and r.name = 'Admin'
      and p.id <> p_user;

    if v_remaining_admins = 0 then
      raise exception 'cannot delete the last active Admin';
    end if;
  end if;

  update public.profiles
  set deleted_at = now(), status = 'suspended'
  where id = p_user;

  -- Reuse the original email for future registrations.
  -- Keep the deleted record hidden, but remove the auth identity lock so signup can proceed.
  v_released_email := format(
    'deleted_%s_%s@deleted.local',
    replace(p_user::text, '-', ''),
    floor(extract(epoch from now()))::bigint
  );

  update auth.users
  set email = v_released_email,
      updated_at = now()
  where id = p_user;

  insert into public.audit_logs (
    actor_id, action, entity, entity_id, old_value, new_value
  )
  values (
    auth.uid(),
    'employee.delete',
    'profile',
    p_user::text,
    jsonb_build_object(
      'first_name', v_old.first_name,
      'last_name', v_old.last_name,
      'email', v_old.email,
      'role_id', v_old.role_id,
      'status', v_old.status,
      'deleted_at', v_old.deleted_at
    ),
    jsonb_build_object('deleted_at', now(), 'auth_email_released', true)
  );
end;
$$;

revoke all on function public.soft_delete_employee(uuid) from public, anon;
grant execute on function public.soft_delete_employee(uuid) to authenticated;
