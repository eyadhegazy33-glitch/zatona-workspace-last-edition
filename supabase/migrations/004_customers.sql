-- ===== STUDENT TYPES (editable list: Kafoury, American, ...) =====
create table public.student_types (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  active boolean not null default true
);
insert into public.student_types (name) values ('Kafoury'), ('American');

-- ===== CUSTOMERS =====
create type public.customer_status as enum ('active','blocked','expired');
create sequence public.customer_code_seq start 1;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  code text unique not null
    default ('ZT-' || lpad(nextval('public.customer_code_seq')::text, 6, '0')),
  -- secret random value stored in the QR code. 64 hex characters, impossible to guess.
  qr_token text unique not null
    default (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')),
  first_name text not null,
  last_name text not null,
  birth_date date not null,
  student_type_id uuid not null references public.student_types(id),
  phone text,
  status public.customer_status not null default 'active',
  expires_on date,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
-- same person (name + birth date) cannot exist twice
create unique index customers_person_unique
  on public.customers (lower(first_name), lower(last_name), birth_date) where deleted_at is null;
create index customers_phone_idx on public.customers (phone) where deleted_at is null;
create index customers_last_name_idx on public.customers (lower(last_name));

-- ===== NEW PERMISSIONS =====
insert into public.permissions (key, description) values
  ('customers.view',   'View customers'),
  ('customers.create', 'Create customers'),
  ('customers.edit',   'Edit, block, unblock customers and re-issue QR'),
  ('customers.delete', 'Delete customers'),
  ('customers.import', 'Import customers from a sheet'),
  ('customers.cards',  'Print customer cards'),
  ('scanner.use',      'Use the scanner'),
  ('checkins.manage',  'Check customers in and out'),
  ('resources.manage', 'Manage seats, rooms and tables')
on conflict do nothing;

-- Admin: everything
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r cross join public.permissions p
where r.name = 'Admin' on conflict do nothing;

-- Manager: everything new
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r join public.permissions p
  on p.key in ('customers.view','customers.create','customers.edit','customers.delete',
               'customers.import','customers.cards','scanner.use','checkins.manage','resources.manage')
where r.name = 'Manager' on conflict do nothing;

-- Reception: view, create, edit, cards, scanner, check-in
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r join public.permissions p
  on p.key in ('customers.view','customers.create','customers.edit','customers.cards','scanner.use','checkins.manage')
where r.name = 'Reception' on conflict do nothing;

-- ===== RLS =====
alter table public.student_types enable row level security;
alter table public.customers enable row level security;

create policy student_types_read on public.student_types for select to authenticated using (true);
create policy student_types_write on public.student_types for all to authenticated
  using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'));

-- reading customers needs permission. NO insert/update/delete policy = browser cannot write directly.
create policy customers_read on public.customers for select to authenticated
  using (public.has_permission('customers.view'));

-- ===== FUNCTIONS (the only way to write customers) =====
create or replace function public.create_customer(
  p_first_name text, p_last_name text, p_birth_date date, p_student_type uuid,
  p_phone text default null, p_expires_on date default null, p_notes text default null)
returns public.customers language plpgsql security definer set search_path = public as $$
declare v public.customers;
begin
  if not public.has_permission('customers.create') then raise exception 'not allowed'; end if;
  if nullif(trim(p_first_name),'') is null or nullif(trim(p_last_name),'') is null then
    raise exception 'name required';
  end if;
  if p_birth_date is null or p_birth_date > current_date then raise exception 'invalid birth date'; end if;

  insert into public.customers (first_name, last_name, birth_date, student_type_id, phone, expires_on, notes, created_by)
  values (trim(p_first_name), trim(p_last_name), p_birth_date, p_student_type,
          nullif(trim(p_phone),''), p_expires_on, p_notes, auth.uid())
  returning * into v;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (auth.uid(), 'customer.create', 'customer', v.id::text, jsonb_build_object('code', v.code));
  return v;
end $$;

create or replace function public.update_customer(
  p_id uuid, p_first_name text, p_last_name text, p_birth_date date, p_student_type uuid,
  p_phone text, p_expires_on date, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.customers;
begin
  if not public.has_permission('customers.edit') then raise exception 'not allowed'; end if;
  select * into o from public.customers where id = p_id and deleted_at is null;
  if not found then raise exception 'customer not found'; end if;
  if p_birth_date is null or p_birth_date > current_date then raise exception 'invalid birth date'; end if;

  update public.customers set
    first_name = trim(p_first_name), last_name = trim(p_last_name), birth_date = p_birth_date,
    student_type_id = p_student_type, phone = nullif(trim(p_phone),''),
    expires_on = p_expires_on, notes = p_notes, updated_at = now()
  where id = p_id;

  insert into public.audit_logs (actor_id, action, entity, entity_id, old_value, new_value)
  values (auth.uid(), 'customer.update', 'customer', p_id::text,
    jsonb_build_object('first_name', o.first_name, 'last_name', o.last_name, 'birth_date', o.birth_date,
                       'phone', o.phone, 'expires_on', o.expires_on),
    jsonb_build_object('first_name', p_first_name, 'last_name', p_last_name, 'birth_date', p_birth_date,
                       'phone', p_phone, 'expires_on', p_expires_on));
end $$;

create or replace function public.set_customer_status(p_id uuid, p_status public.customer_status, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o public.customer_status;
begin
  if not public.has_permission('customers.edit') then raise exception 'not allowed'; end if;
  select status into o from public.customers where id = p_id and deleted_at is null;
  if not found then raise exception 'customer not found'; end if;
  update public.customers set status = p_status, updated_at = now() where id = p_id;
  insert into public.audit_logs (actor_id, action, entity, entity_id, old_value, new_value)
  values (auth.uid(), 'customer.status', 'customer', p_id::text,
          jsonb_build_object('status', o), jsonb_build_object('status', p_status, 'note', p_note));
end $$;

create or replace function public.soft_delete_customer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('customers.delete') then raise exception 'not allowed'; end if;
  update public.customers set deleted_at = now() where id = p_id and deleted_at is null;
  insert into public.audit_logs (actor_id, action, entity, entity_id)
  values (auth.uid(), 'customer.delete', 'customer', p_id::text);
end $$;

-- lost card: make a new secret, the old QR stops working immediately
create or replace function public.reissue_qr_token(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('customers.edit') then raise exception 'not allowed'; end if;
  update public.customers
     set qr_token = replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''),
         updated_at = now()
   where id = p_id and deleted_at is null;
  insert into public.audit_logs (actor_id, action, entity, entity_id)
  values (auth.uid(), 'customer.reissue_qr', 'customer', p_id::text);
end $$;

-- ===== HARDENING: only logged-in users can call the functions =====
revoke execute on function public.create_customer(text,text,date,uuid,text,date,text) from public, anon;
revoke execute on function public.update_customer(uuid,text,text,date,uuid,text,date,text) from public, anon;
revoke execute on function public.set_customer_status(uuid,public.customer_status,text) from public, anon;
revoke execute on function public.soft_delete_customer(uuid) from public, anon;
revoke execute on function public.reissue_qr_token(uuid) from public, anon;
revoke execute on function public.approve_account(uuid,uuid) from public, anon;
revoke execute on function public.reject_account(uuid,text) from public, anon;
grant execute on function public.create_customer(text,text,date,uuid,text,date,text) to authenticated;
grant execute on function public.update_customer(uuid,text,text,date,uuid,text,date,text) to authenticated;
grant execute on function public.set_customer_status(uuid,public.customer_status,text) to authenticated;
grant execute on function public.soft_delete_customer(uuid) to authenticated;
grant execute on function public.reissue_qr_token(uuid) to authenticated;
grant execute on function public.approve_account(uuid,uuid) to authenticated;
grant execute on function public.reject_account(uuid,text) to authenticated;
