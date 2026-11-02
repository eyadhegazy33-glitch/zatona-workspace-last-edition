-- ===== ENUM =====
create type public.account_status as enum ('pending','active','rejected','suspended');

-- ===== ROLES AND PERMISSIONS =====
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  is_system boolean not null default false,       -- system roles (Admin) cannot be deleted or requested at register
  is_registrable boolean not null default true,   -- shown in the register form list
  created_at timestamptz not null default now()
);

create table public.permissions (
  key text primary key,
  description text
);

create table public.role_permissions (
  role_id uuid references public.roles(id) on delete cascade,
  permission_key text references public.permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

-- ===== PROFILES =====
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text not null,
  requested_role_id uuid references public.roles(id),
  role_id uuid references public.roles(id),
  status public.account_status not null default 'pending',
  reject_reason text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index profiles_email_unique on public.profiles (lower(email)) where deleted_at is null;

-- ===== NOTIFICATIONS =====
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- ===== AUDIT LOG (append only) =====
create table public.audit_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  entity text,
  entity_id text,
  old_value jsonb,
  new_value jsonb
);

-- ===== HELPER: does the current user have a permission? =====
create or replace function public.has_permission(p_key text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id
    where p.id = auth.uid()
      and p.status = 'active'
      and p.deleted_at is null
      and rp.permission_key = p_key
  );
$$;

-- ===== TRIGGER: create profile automatically when someone registers =====
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  req uuid;
begin
  begin
    req := nullif(new.raw_user_meta_data->>'requested_role_id','')::uuid;
  exception when others then
    req := null;
  end;

  -- the requested role must exist and be registrable (so nobody can request Admin)
  if req is not null and not exists (select 1 from public.roles where id = req and is_registrable) then
    req := null;
  end if;

  insert into public.profiles (id, first_name, last_name, email, requested_role_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name',''),
    coalesce(new.raw_user_meta_data->>'last_name',''),
    new.email,
    req
  );

  -- tell every active user who can approve accounts
  insert into public.notifications (user_id, type, payload)
  select p.id, 'account_pending',
         jsonb_build_object('user_id', new.id, 'email', new.email)
  from public.profiles p
  join public.role_permissions rp on rp.role_id = p.role_id
  where rp.permission_key = 'accounts.approve' and p.status = 'active' and p.id <> new.id;

  insert into public.audit_logs (actor_id, action, entity, entity_id)
  values (new.id, 'account.register', 'profile', new.id::text);

  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ===== APPROVE / REJECT (only through these functions) =====
create or replace function public.approve_account(p_user uuid, p_role uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('accounts.approve') then
    raise exception 'not allowed';
  end if;
  -- only people who can manage roles may give a system role (Admin)
  if exists (select 1 from public.roles where id = p_role and is_system)
     and not public.has_permission('roles.manage') then
    raise exception 'not allowed to assign this role';
  end if;

  update public.profiles
     set status = 'active', role_id = p_role, approved_by = auth.uid(),
         approved_at = now(), reject_reason = null
   where id = p_user and status = 'pending';

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (auth.uid(), 'account.approve', 'profile', p_user::text, jsonb_build_object('role_id', p_role));

  insert into public.notifications (user_id, type) values (p_user, 'account_approved');
end $$;

create or replace function public.reject_account(p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('accounts.approve') then
    raise exception 'not allowed';
  end if;

  update public.profiles
     set status = 'rejected', reject_reason = p_reason
   where id = p_user and status = 'pending';

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (auth.uid(), 'account.reject', 'profile', p_user::text, jsonb_build_object('reason', p_reason));
end $$;

-- ===== ROW LEVEL SECURITY =====
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- roles: visitors can see only registrable roles (for the register form)
create policy roles_anon_read on public.roles for select to anon using (is_registrable);
create policy roles_auth_read on public.roles for select to authenticated using (true);

create policy permissions_read on public.permissions for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);

-- profiles: own row, or people with permission. No direct update/delete from the browser.
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid()
         or public.has_permission('employees.view')
         or public.has_permission('accounts.approve'));

-- notifications: only your own
create policy notifications_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- audit log: readable by permission, nobody can insert/update/delete from the browser
create policy audit_read on public.audit_logs for select to authenticated using (public.has_permission('audit.view'));

-- ===== SEED: roles and permissions (this is configuration, not demo data) =====
insert into public.roles (name, is_system, is_registrable) values
  ('Admin', true, false),
  ('Manager', false, true),
  ('Reception', false, true),
  ('Barista', false, true);

insert into public.permissions (key, description) values
  ('accounts.approve', 'Approve or reject new accounts'),
  ('employees.view', 'View employees'),
  ('employees.manage', 'Add, edit, suspend, delete employees'),
  ('roles.manage', 'Create and edit roles and permissions'),
  ('audit.view', 'View the security audit log'),
  ('settings.manage', 'Change settings and branding'),
  ('dashboard.view', 'View the dashboard');

-- Admin gets everything
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r cross join public.permissions p where r.name = 'Admin';

-- Manager gets a subset (cannot manage roles or settings)
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r join public.permissions p
  on p.key in ('accounts.approve','employees.view','employees.manage','audit.view','dashboard.view')
where r.name = 'Manager';
