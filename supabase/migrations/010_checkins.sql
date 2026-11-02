create table public.resources (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('seat', 'room', 'table')),
  name text not null,
  capacity integer not null default 1 check (capacity > 0),
  status text not null default 'available'
    check (status in ('available', 'maintenance')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (type, name)
);

alter table public.checkins
  add column resource_id uuid references public.resources(id),
  add column timer_started_at timestamptz,
  add column last_qualifying_order_at timestamptz,
  add column checked_out_at timestamptz,
  add column created_by uuid references public.profiles(id),
  add column closed_by uuid references public.profiles(id);

update public.checkins
set timer_started_at = checked_in_at,
    created_by = scanned_by,
    checked_out_at = checked_in_at
where timer_started_at is null;

alter table public.checkins
  alter column timer_started_at set default now(),
  alter column timer_started_at set not null;

create unique index checkins_one_open_per_customer
  on public.checkins (customer_id)
  where checked_out_at is null;
create index checkins_open_idx
  on public.checkins (checked_in_at)
  where checked_out_at is null;

create table public.scan_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references public.profiles(id),
  customer_id uuid references public.customers(id),
  input_hint text,
  result text not null check (result in ('ok', 'blocked', 'expired', 'unknown'))
);

alter table public.resources enable row level security;
alter table public.checkins enable row level security;
alter table public.scan_logs enable row level security;

create policy resources_read
  on public.resources
  for select
  to authenticated
  using (
    public.has_permission('resources.manage')
    or public.has_permission('checkins.manage')
    or public.has_permission('scanner.use')
    or public.has_permission('dashboard.view')
  );

create policy resources_write
  on public.resources
  for all
  to authenticated
  using (public.has_permission('resources.manage'))
  with check (public.has_permission('resources.manage'));

drop policy if exists checkins_read on public.checkins;
create policy checkins_read
  on public.checkins
  for select
  to authenticated
  using (
    public.has_permission('checkins.manage')
    or public.has_permission('dashboard.view')
    or public.has_permission('customers.view')
  );

create policy scan_logs_read
  on public.scan_logs
  for select
  to authenticated
  using (public.has_permission('audit.view'));

revoke all on public.resources, public.checkins, public.scan_logs
  from public, anon, authenticated;
grant select, insert, update, delete on public.resources to authenticated;
grant select on public.checkins, public.scan_logs to authenticated;
grant usage, select on sequence public.scan_logs_id_seq to authenticated;

create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (
    actor_id, action, entity, entity_id, old_value, new_value
  )
  values (
    auth.uid(),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id'),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger resources_audit
  after insert or update or delete on public.resources
  for each row execute function public.audit_row();

create or replace function public.scan_customer(p_input text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.customers;
  v_input text := trim(coalesce(p_input, ''));
  v_result text;
  v_checkin public.checkins;
begin
  if not public.has_permission('scanner.use') then
    raise exception 'not allowed';
  end if;

  if length(v_input) > 512 then
    v_input := '';
  end if;

  select *
    into c
  from public.customers
  where deleted_at is null
    and (qr_token = v_input or upper(code) = upper(v_input))
  limit 1;

  if not found then
    insert into public.scan_logs (user_id, result)
    values (auth.uid(), 'unknown');
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  v_result := case
    when c.status = 'blocked' then 'blocked'
    when c.status = 'expired'
      or (c.expiry_date is not null and c.expiry_date < current_date)
      then 'expired'
    else 'ok'
  end;

  insert into public.scan_logs (user_id, customer_id, result)
  values (auth.uid(), c.id, v_result);

  select *
    into v_checkin
  from public.checkins
  where customer_id = c.id
    and checked_out_at is null
  order by checked_in_at desc
  limit 1;

  return jsonb_build_object(
    'ok', v_result = 'ok',
    'reason', v_result,
    'customer', jsonb_build_object(
      'id', c.id,
      'code', c.code,
      'first_name', c.first_name,
      'last_name', c.last_name,
      'birth_date', c.birth_date
    ),
    'checkin', case
      when v_checkin.id is not null then to_jsonb(v_checkin)
      else null
    end
  );
end;
$$;

create or replace function public.check_in(
  p_customer uuid,
  p_resource uuid default null
)
returns public.checkins
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.customers;
  r public.resources;
  v public.checkins;
begin
  if not public.has_permission('checkins.manage') then
    raise exception 'not allowed';
  end if;

  select *
    into c
  from public.customers
  where id = p_customer
    and deleted_at is null
  for update;

  if not found then
    raise exception 'customer not found';
  end if;

  if c.status <> 'active'
     or (c.expiry_date is not null and c.expiry_date < current_date) then
    raise exception 'customer not allowed to enter';
  end if;

  if exists (
    select 1 from public.checkins
    where customer_id = p_customer and checked_out_at is null
  ) then
    raise exception 'already checked in';
  end if;

  if p_resource is not null then
    select *
      into r
    from public.resources
    where id = p_resource
      and active
    for update;

    if not found or r.status <> 'available' then
      raise exception 'resource not available';
    end if;

    if (
      select count(*)
      from public.checkins
      where resource_id = p_resource
        and checked_out_at is null
    ) >= r.capacity then
      raise exception 'resource is full';
    end if;
  end if;

  insert into public.checkins (
    customer_id, resource_id, created_by, scanned_by, timer_started_at
  )
  values (
    p_customer, p_resource, auth.uid(), auth.uid(), now()
  )
  returning * into v;

  return v;
end;
$$;

create or replace function public.check_out(p_checkin bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('checkins.manage') then
    raise exception 'not allowed';
  end if;

  update public.checkins
  set checked_out_at = now(),
      closed_by = auth.uid()
  where id = p_checkin
    and checked_out_at is null;

  if not found then
    raise exception 'visit not found or already closed';
  end if;
end;
$$;

create or replace function public.get_resource_occupancy()
returns table (resource_id uuid, people_inside bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.has_permission('resources.manage')
    or public.has_permission('checkins.manage')
    or public.has_permission('scanner.use')
    or public.has_permission('dashboard.view')
  ) then
    raise exception 'not allowed';
  end if;

  return query
    select r.id, count(c.id)
    from public.resources r
    left join public.checkins c
      on c.resource_id = r.id
      and c.checked_out_at is null
    group by r.id;
end;
$$;

create or replace function public.log_card_print(p_count integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('customers.cards') then
    raise exception 'not allowed';
  end if;
  if p_count is null or p_count < 1 or p_count > 500 then
    raise exception 'invalid card count';
  end if;

  insert into public.audit_logs (actor_id, action, entity, new_value)
  values (
    auth.uid(),
    'cards.print',
    'customer_cards',
    jsonb_build_object('count', p_count)
  );
end;
$$;

insert into public.permissions (key, description)
values
  ('resources.manage', 'Manage seats, rooms, and tables'),
  ('checkins.manage', 'Check customers in and out'),
  ('scanner.use', 'Scan customer cards')
on conflict (key) do update
set description = excluded.description;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.name = 'Admin'
  and p.key in ('resources.manage', 'checkins.manage', 'scanner.use')
on conflict (role_id, permission_key) do nothing;

revoke all on function public.audit_row() from public, anon, authenticated;
revoke all on function public.scan_customer(text) from public, anon;
revoke all on function public.check_in(uuid, uuid) from public, anon;
revoke all on function public.check_out(bigint) from public, anon;
revoke all on function public.get_resource_occupancy() from public, anon;
revoke all on function public.log_card_print(integer) from public, anon;

grant execute on function public.scan_customer(text) to authenticated;
grant execute on function public.check_in(uuid, uuid) to authenticated;
grant execute on function public.check_out(bigint) to authenticated;
grant execute on function public.get_resource_occupancy() to authenticated;
grant execute on function public.log_card_print(integer) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'checkins'
  ) then
    alter publication supabase_realtime add table public.checkins;
  end if;
end;
$$;
