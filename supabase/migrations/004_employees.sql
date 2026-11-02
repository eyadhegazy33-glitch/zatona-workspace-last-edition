alter table public.profiles
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_profile_updated_at();

create index if not exists profiles_employees_listing_idx
  on public.profiles (updated_at desc)
  where role_id is not null and deleted_at is null;

create or replace function public.update_employee(
  p_user uuid,
  p_first_name text,
  p_last_name text,
  p_role uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.profiles%rowtype;
  v_new public.profiles%rowtype;
  v_new_role_is_system boolean;
  v_current_role_is_system boolean;
  v_new_role_name text;
  v_current_role_name text;
  v_remaining_admins bigint;
begin
  if not public.has_permission('employees.manage') then
    raise exception 'not allowed';
  end if;

  if p_first_name is null or length(trim(p_first_name)) not between 2 and 50
     or p_last_name is null or length(trim(p_last_name)) not between 2 and 50 then
    raise exception 'invalid employee name';
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

  select (coalesce(r.is_system, false) or r.name = 'Admin'), r.name
    into v_current_role_is_system, v_current_role_name
  from public.roles r
  where r.id = v_old.role_id;
  v_current_role_is_system := coalesce(v_current_role_is_system, false);

  select (r.is_system or r.name = 'Admin'), r.name
    into v_new_role_is_system, v_new_role_name
  from public.roles r
  where r.id = p_role;

  if not found then
    raise exception 'role not found';
  end if;

  if (v_current_role_is_system or v_new_role_is_system)
     and not public.has_permission('roles.manage') then
    raise exception 'not allowed to manage an Admin role';
  end if;

  if v_old.status = 'active'
     and v_current_role_name = 'Admin'
     and v_new_role_name <> 'Admin' then
    select count(*) into v_remaining_admins
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.status = 'active'
      and p.deleted_at is null
      and r.name = 'Admin'
      and p.id <> p_user;

    if v_remaining_admins = 0 then
      raise exception 'cannot remove the last active Admin';
    end if;
  end if;

  update public.profiles
  set first_name = trim(p_first_name),
      last_name = trim(p_last_name),
      role_id = p_role
  where id = p_user
  returning * into v_new;

  insert into public.audit_logs (
    actor_id, action, entity, entity_id, old_value, new_value
  )
  values (
    auth.uid(),
    'employee.update',
    'profile',
    p_user::text,
    jsonb_build_object(
      'first_name', v_old.first_name,
      'last_name', v_old.last_name,
      'role_id', v_old.role_id
    ),
    jsonb_build_object(
      'first_name', v_new.first_name,
      'last_name', v_new.last_name,
      'role_id', v_new.role_id
    )
  );
end;
$$;

create or replace function public.set_employee_status(
  p_user uuid,
  p_status public.account_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.profiles%rowtype;
  v_role_is_system boolean;
  v_remaining_admins bigint;
begin
  if not public.has_permission('employees.manage') then
    raise exception 'not allowed';
  end if;

  if p_status is null or p_status not in ('active', 'suspended') then
    raise exception 'status must be active or suspended';
  end if;

  if p_user = auth.uid() and p_status = 'suspended' then
    raise exception 'cannot suspend yourself';
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
     and p_status <> 'active'
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
      raise exception 'cannot suspend the last active Admin';
    end if;
  end if;

  update public.profiles
  set status = p_status
  where id = p_user;

  insert into public.audit_logs (
    actor_id, action, entity, entity_id, old_value, new_value
  )
  values (
    auth.uid(),
    case when p_status = 'suspended'
      then 'employee.suspend'
      else 'employee.reactivate'
    end,
    'profile',
    p_user::text,
    jsonb_build_object('status', v_old.status),
    jsonb_build_object('status', p_status)
  );
end;
$$;

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
  set deleted_at = now()
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
    jsonb_build_object('deleted_at', now())
  );
end;
$$;

revoke all on function public.update_employee(uuid, text, text, uuid) from public, anon;
revoke all on function public.set_employee_status(uuid, public.account_status) from public, anon;
revoke all on function public.soft_delete_employee(uuid) from public, anon;

grant execute on function public.update_employee(uuid, text, text, uuid) to authenticated;
grant execute on function public.set_employee_status(uuid, public.account_status) to authenticated;
grant execute on function public.soft_delete_employee(uuid) to authenticated;
