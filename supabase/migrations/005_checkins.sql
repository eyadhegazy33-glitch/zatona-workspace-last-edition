-- ===== RESOURCES: seats, rooms, tables =====
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('seat','room','table')),
  name text not null,
  capacity int not null default 1 check (capacity > 0),
  status text not null default 'available' check (status in ('available','maintenance')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (type, name)
);

-- ===== CHECK-INS =====
create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  resource_id uuid references public.resources(id),
  checked_in_at timestamptz not null default now(),
  timer_started_at timestamptz not null default now(),   -- used by the 3-hour timer in Phase 3
  last_qualifying_order_at timestamptz,                  -- used by the 3-hour timer in Phase 3
  checked_out_at timestamptz,
  created_by uuid references public.profiles(id),
  closed_by uuid references public.profiles(id)
);
-- one open visit per customer
create unique index checkins_one_open_per_customer on public.checkins (customer_id) where checked_out_at is null;
create index checkins_open_idx on public.checkins (checked_in_at) where checked_out_at is null;

-- ===== SCAN LOG (every scan, success or fail) =====
create table public.scan_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references public.profiles(id),
  customer_id uuid references public.customers(id),
  input_hint text,           -- only the first 4 characters, never the full secret
  result text not null       -- ok | blocked | expired | unknown
);

-- ===== RLS =====
alter table public.resources enable row level security;
alter table public.checkins enable row level security;
alter table public.scan_logs enable row level security;

create policy resources_read on public.resources for select to authenticated
  using (public.has_permission('resources.manage') or public.has_permission('checkins.manage')
         or public.has_permission('scanner.use') or public.has_permission('dashboard.view'));
create policy resources_write on public.resources for all to authenticated
  using (public.has_permission('resources.manage')) with check (public.has_permission('resources.manage'));

create policy checkins_read on public.checkins for select to authenticated
  using (public.has_permission('checkins.manage') or public.has_permission('dashboard.view')
         or public.has_permission('customers.view'));
-- no write policies on checkins: only the functions below can write

create policy scan_logs_read on public.scan_logs for select to authenticated
  using (public.has_permission('audit.view'));

-- ===== GENERIC AUDIT TRIGGER for resources =====
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (actor_id, action, entity, entity_id, old_value, new_value)
  values (auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name,
          coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id'),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create trigger resources_audit after insert or update or delete on public.resources
  for each row execute function public.audit_row();

-- ===== SCAN =====
create or replace function public.scan_customer(p_input text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.customers;
  v_in text := trim(coalesce(p_input,''));
  v_result text;
  v_checkin public.checkins;
begin
  if not public.has_permission('scanner.use') then raise exception 'not allowed'; end if;

  -- the QR secret OR the printed code (manual entry)
  select * into c from public.customers
   where deleted_at is null and (qr_token = v_in or upper(code) = upper(v_in)) limit 1;

  if not found then
    insert into public.scan_logs (user_id, input_hint, result) values (auth.uid(), left(v_in,4) || '...', 'unknown');
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  v_result := case
    when c.status = 'blocked' then 'blocked'
    when c.status = 'expired' or (c.expires_on is not null and c.expires_on < current_date) then 'expired'
    else 'ok' end;

  insert into public.scan_logs (user_id, customer_id, input_hint, result)
  values (auth.uid(), c.id, left(v_in,4) || '...', v_result);

  select * into v_checkin from public.checkins where customer_id = c.id and checked_out_at is null;

  return jsonb_build_object(
    'ok', v_result = 'ok',
    'reason', v_result,
    'customer', jsonb_build_object('id', c.id, 'code', c.code, 'first_name', c.first_name,
                                   'last_name', c.last_name, 'birth_date', c.birth_date),
    'checkin', case when v_checkin.id is not null then to_jsonb(v_checkin) end
  );
end $$;

-- ===== CHECK IN / OUT =====
create or replace function public.check_in(p_customer uuid, p_resource uuid default null)
returns public.checkins language plpgsql security definer set search_path = public as $$
declare c public.customers; r public.resources; v public.checkins;
begin
  if not public.has_permission('checkins.manage') then raise exception 'not allowed'; end if;

  select * into c from public.customers where id = p_customer and deleted_at is null;
  if not found then raise exception 'customer not found'; end if;
  if c.status <> 'active' or (c.expires_on is not null and c.expires_on < current_date) then
    raise exception 'customer not allowed to enter';
  end if;
  if exists (select 1 from public.checkins where customer_id = p_customer and checked_out_at is null) then
    raise exception 'already checked in';
  end if;

  if p_resource is not null then
    select * into r from public.resources where id = p_resource and active for update;  -- lock: no double booking race
    if not found or r.status <> 'available' then raise exception 'resource not available'; end if;
    if (select count(*) from public.checkins where resource_id = p_resource and checked_out_at is null) >= r.capacity then
      raise exception 'resource is full';
    end if;
  end if;

  insert into public.checkins (customer_id, resource_id, created_by)
  values (p_customer, p_resource, auth.uid()) returning * into v;
  return v;
end $$;

create or replace function public.check_out(p_checkin uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('checkins.manage') then raise exception 'not allowed'; end if;
  update public.checkins set checked_out_at = now(), closed_by = auth.uid()
   where id = p_checkin and checked_out_at is null;
  if not found then raise exception 'visit not found or already closed'; end if;
end $$;

revoke execute on function public.scan_customer(text) from public, anon;
revoke execute on function public.check_in(uuid, uuid) from public, anon;
revoke execute on function public.check_out(uuid) from public, anon;
grant execute on function public.scan_customer(text) to authenticated;
grant execute on function public.check_in(uuid, uuid) to authenticated;
grant execute on function public.check_out(uuid) to authenticated;

-- live updates for the "inside now" list
alter publication supabase_realtime add table public.checkins;
