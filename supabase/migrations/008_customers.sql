create sequence public.customer_code_seq;

create type public.customer_status as enum ('active', 'blocked', 'expired');

create table if not exists public.student_types (
  id uuid primary key default gen_random_uuid(),
  name_en text not null unique,
  name_ar text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.student_types (name_en, name_ar)
values
  ('American Student', 'طالب أمريكي'),
  ('Invited Student', 'طالب مدعو')
on conflict (name_en) do update
set name_ar = excluded.name_ar,
    is_active = true;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default (
    'ZT-' || to_char(nextval('public.customer_code_seq'), 'FM000000')
  ),
  first_name text not null,
  last_name text not null,
  full_name text generated always as (
    btrim(first_name) || ' ' || btrim(last_name)
  ) stored,
  birth_date date not null,
  student_type_id uuid not null references public.student_types(id),
  phone text,
  expiry_date date,
  notes text,
  status public.customer_status not null default 'active',
  qr_token text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint customers_first_name_length check (length(btrim(first_name)) between 2 and 50),
  constraint customers_last_name_length check (length(btrim(last_name)) between 2 and 50),
  constraint customers_birth_date_not_future check (birth_date <= current_date),
  constraint customers_phone_valid check (
    phone is null or phone ~ '^[0-9 +-]+$'
  ),
  constraint customers_notes_length check (notes is null or length(notes) <= 2000)
);

create unique index customers_name_birth_date_unique
  on public.customers (lower(full_name), birth_date)
  where deleted_at is null;

create index customers_created_at_idx on public.customers (created_at desc);
create index customers_student_type_idx on public.customers (student_type_id);
create index customers_status_idx on public.customers (status) where deleted_at is null;
create index customers_phone_idx on public.customers (phone) where deleted_at is null;

create table public.checkins (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.customers(id),
  checked_in_at timestamptz not null default now(),
  scanned_by uuid references public.profiles(id)
);

create index checkins_customer_history_idx
  on public.checkins (customer_id, checked_in_at desc);

alter table public.student_types enable row level security;
alter table public.customers enable row level security;
alter table public.checkins enable row level security;

create policy student_types_read
  on public.student_types
  for select
  to authenticated
  using (
    is_active
    and (
      public.has_permission('customers.view')
      or public.has_permission('customers.create')
      or public.has_permission('customers.edit')
    )
  );

create policy customers_read
  on public.customers
  for select
  to authenticated
  using (
    deleted_at is null
    and public.has_permission('customers.view')
  );

create policy checkins_read
  on public.checkins
  for select
  to authenticated
  using (
    public.has_permission('customers.view')
    and exists (
      select 1
      from public.customers c
      where c.id = checkins.customer_id
        and c.deleted_at is null
    )
  );

revoke all on public.student_types, public.customers, public.checkins
  from public, anon, authenticated;
grant select on public.student_types to authenticated;
grant select (
  id, code, first_name, last_name, full_name, birth_date, student_type_id,
  phone, expiry_date, notes, status, created_at, updated_at, deleted_at
) on public.customers to authenticated;
grant select (id, customer_id, checked_in_at)
  on public.checkins to authenticated;

insert into public.permissions (key, description)
values
  ('customers.view', 'View customer records and visit history'),
  ('customers.create', 'Create customer records'),
  ('customers.edit', 'Edit and change customer status'),
  ('customers.delete', 'Soft-delete customer records'),
  ('customers.import', 'Import customer records'),
  ('customers.cards', 'Print customer cards and manage QR tokens')
on conflict (key) do update
set description = excluded.description;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.name = 'Admin'
  and p.key like 'customers.%'
on conflict (role_id, permission_key) do nothing;

create or replace function public.create_customer(
  p_first_name text,
  p_last_name text,
  p_birth_date date,
  p_student_type_id uuid,
  p_phone text default null,
  p_expiry_date date default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
begin
  if not public.has_permission('customers.create') then
    raise exception 'not allowed';
  end if;

  if p_first_name is null or length(btrim(p_first_name)) not between 2 and 50
     or p_last_name is null or length(btrim(p_last_name)) not between 2 and 50 then
    raise exception 'invalid customer name';
  end if;
  if p_birth_date is null or p_birth_date > current_date then
    raise exception 'invalid birth date';
  end if;
  if not exists (
    select 1 from public.student_types
    where id = p_student_type_id and is_active
  ) then
    raise exception 'invalid student type';
  end if;
  if nullif(btrim(p_phone), '') is not null
     and btrim(p_phone) !~ '^[0-9 +-]+$' then
    raise exception 'invalid phone';
  end if;
  if p_notes is not null and length(p_notes) > 2000 then
    raise exception 'notes are too long';
  end if;

  insert into public.customers (
    first_name, last_name, birth_date, student_type_id, phone, expiry_date, notes
  )
  values (
    btrim(p_first_name), btrim(p_last_name), p_birth_date, p_student_type_id,
    nullif(btrim(p_phone), ''), p_expiry_date, nullif(btrim(p_notes), '')
  )
  returning id into v_customer_id;

  insert into public.audit_logs (actor_id, action, entity, entity_id)
  values (auth.uid(), 'customer.create', 'customer', v_customer_id::text);

  return v_customer_id;
end;
$$;

create or replace function public.update_customer(
  p_customer uuid,
  p_first_name text,
  p_last_name text,
  p_birth_date date,
  p_student_type_id uuid,
  p_phone text default null,
  p_expiry_date date default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_student_type_id uuid;
begin
  if not public.has_permission('customers.edit') then
    raise exception 'not allowed';
  end if;
  if p_first_name is null or length(btrim(p_first_name)) not between 2 and 50
     or p_last_name is null or length(btrim(p_last_name)) not between 2 and 50 then
    raise exception 'invalid customer name';
  end if;
  if p_birth_date is null or p_birth_date > current_date then
    raise exception 'invalid birth date';
  end if;
  if not exists (
    select 1 from public.student_types
    where id = p_student_type_id and is_active
  ) then
    raise exception 'invalid student type';
  end if;
  if nullif(btrim(p_phone), '') is not null
     and btrim(p_phone) !~ '^[0-9 +-]+$' then
    raise exception 'invalid phone';
  end if;
  if p_notes is not null and length(p_notes) > 2000 then
    raise exception 'notes are too long';
  end if;

  select student_type_id into v_old_student_type_id
  from public.customers
  where id = p_customer and deleted_at is null
  for update;
  if not found then
    raise exception 'customer not found';
  end if;

  update public.customers
  set first_name = btrim(p_first_name),
      last_name = btrim(p_last_name),
      birth_date = p_birth_date,
      student_type_id = p_student_type_id,
      phone = nullif(btrim(p_phone), ''),
      expiry_date = p_expiry_date,
      notes = nullif(btrim(p_notes), ''),
      updated_at = now()
  where id = p_customer;

  insert into public.audit_logs (
    actor_id, action, entity, entity_id, old_value, new_value
  )
  values (
    auth.uid(), 'customer.update', 'customer', p_customer::text,
    jsonb_build_object('student_type_id', v_old_student_type_id),
    jsonb_build_object('student_type_id', p_student_type_id)
  );
end;
$$;

create or replace function public.set_customer_status(
  p_customer uuid,
  p_status public.customer_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status public.customer_status;
begin
  if not public.has_permission('customers.edit') then
    raise exception 'not allowed';
  end if;
  if p_status is null then
    raise exception 'invalid customer status';
  end if;

  select status into v_old_status
  from public.customers
  where id = p_customer and deleted_at is null
  for update;
  if not found then
    raise exception 'customer not found';
  end if;

  update public.customers
  set status = p_status, updated_at = now()
  where id = p_customer;

  insert into public.audit_logs (
    actor_id, action, entity, entity_id, old_value, new_value
  )
  values (
    auth.uid(), 'customer.status', 'customer', p_customer::text,
    jsonb_build_object('status', v_old_status),
    jsonb_build_object('status', p_status)
  );
end;
$$;

create or replace function public.soft_delete_customer(p_customer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status public.customer_status;
begin
  if not public.has_permission('customers.delete') then
    raise exception 'not allowed';
  end if;

  select status into v_old_status
  from public.customers
  where id = p_customer and deleted_at is null
  for update;
  if not found then
    raise exception 'customer not found';
  end if;

  update public.customers
  set deleted_at = now(), updated_at = now()
  where id = p_customer;

  insert into public.audit_logs (
    actor_id, action, entity, entity_id, old_value, new_value
  )
  values (
    auth.uid(), 'customer.delete', 'customer', p_customer::text,
    jsonb_build_object('status', v_old_status),
    jsonb_build_object('deleted', true)
  );
end;
$$;

create or replace function public.reissue_qr_token(p_customer uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_qr_token text;
begin
  if not public.has_permission('customers.edit') then
    raise exception 'not allowed';
  end if;

  update public.customers
  set qr_token = encode(extensions.gen_random_bytes(32), 'hex'),
      updated_at = now()
  where id = p_customer and deleted_at is null
  returning qr_token into v_qr_token;
  if not found then
    raise exception 'customer not found';
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id)
  values (auth.uid(), 'customer.qr.reissue', 'customer', p_customer::text);

  return v_qr_token;
end;
$$;

create or replace function public.get_customer_qr_token(p_customer uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qr_token text;
begin
  if not public.has_permission('customers.cards') then
    raise exception 'not allowed';
  end if;

  select qr_token into v_qr_token
  from public.customers
  where id = p_customer and deleted_at is null;
  if not found then
    raise exception 'customer not found';
  end if;

  return v_qr_token;
end;
$$;

revoke all on function public.create_customer(text, text, date, uuid, text, date, text)
  from public, anon;
revoke all on function public.update_customer(uuid, text, text, date, uuid, text, date, text)
  from public, anon;
revoke all on function public.set_customer_status(uuid, public.customer_status)
  from public, anon;
revoke all on function public.soft_delete_customer(uuid) from public, anon;
revoke all on function public.reissue_qr_token(uuid) from public, anon;
revoke all on function public.get_customer_qr_token(uuid) from public, anon;

grant execute on function public.create_customer(text, text, date, uuid, text, date, text)
  to authenticated;
grant execute on function public.update_customer(uuid, text, text, date, uuid, text, date, text)
  to authenticated;
grant execute on function public.set_customer_status(uuid, public.customer_status)
  to authenticated;
grant execute on function public.soft_delete_customer(uuid) to authenticated;
grant execute on function public.reissue_qr_token(uuid) to authenticated;
grant execute on function public.get_customer_qr_token(uuid) to authenticated;
