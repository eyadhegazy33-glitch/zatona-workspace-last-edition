begin;

create table if not exists public.fees (
  id uuid primary key default gen_random_uuid(),
  checkin_id bigint not null references public.checkins(id),
  customer_id uuid not null references public.customers(id),
  cycle_start timestamptz not null,
  block_number integer not null,
  amount numeric(10, 2) not null check (amount > 0),
  status text not null default 'due' check (status in ('due', 'paid', 'waived')),
  waived_by uuid references public.profiles(id),
  waive_reason text,
  receipt_id uuid,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (checkin_id, cycle_start, block_number)
);

create index if not exists fees_customer_due_idx
  on public.fees (customer_id)
  where status = 'due';

insert into public.permissions (key, description)
values
  ('timers.view', 'See the live timers board'),
  ('fees.view', 'See fees'),
  ('fees.waive', 'Waive a fee')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.name = 'Admin'
  and p.key in ('timers.view', 'fees.view', 'fees.waive')
on conflict (role_id, permission_key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, x.key
from public.roles r
join (
  values
    ('Manager', 'timers.view'),
    ('Manager', 'fees.view'),
    ('Manager', 'fees.waive'),
    ('Reception', 'timers.view'),
    ('Reception', 'fees.view'),
    ('Barista', 'timers.view')
) as x(role, key) on x.role = r.name
on conflict (role_id, permission_key) do nothing;

alter table public.fees enable row level security;

drop policy if exists fees_read on public.fees;
create policy fees_read
  on public.fees
  for select
  to authenticated
  using (public.has_permission('fees.view'));

create or replace function public.accrue_fees(p_checkin bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  k public.checkins;
  v_window numeric;
  v_grace numeric;
  v_fee numeric;
  v_base timestamptz;
  v_first timestamptz;
  v_blocks integer;
  i integer;
  n integer := 0;
begin
  select * into k
  from public.checkins
  where id = p_checkin
    and checked_out_at is null;

  if not found then
    return 0;
  end if;

  v_window := public.ops_num('ops.timer_window_minutes', 180);
  v_grace := public.ops_num('ops.timer_grace_minutes', 0);
  v_fee := public.ops_num('ops.overdue_fee', 0);

  if v_fee <= 0 or v_window <= 0 then
    return 0;
  end if;

  v_base := greatest(
    k.timer_started_at,
    coalesce(k.last_qualifying_order_at, k.timer_started_at)
  );
  v_first := v_base
    + make_interval(mins => v_window::integer)
    + make_interval(mins => v_grace::integer);

  if now() < v_first then
    return 0;
  end if;

  v_blocks := 1;
  if public.ops_text('ops.fee_repeats', 'true') = 'true' then
    v_blocks := 1 + floor(
      extract(epoch from (now() - v_first)) / (v_window * 60)
    )::integer;
  end if;

  for i in 1..v_blocks loop
    insert into public.fees (checkin_id, customer_id, cycle_start, block_number, amount)
    values (k.id, k.customer_id, v_base, i, v_fee)
    on conflict (checkin_id, cycle_start, block_number) do nothing;

    if found then
      n := n + 1;
    end if;
  end loop;

  return n;
end;
$$;

create or replace function public.run_timer_job()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  total integer := 0;
begin
  for r in
    select id
    from public.checkins
    where checked_out_at is null
  loop
    total := total + public.accrue_fees(r.id);
  end loop;

  return total;
end;
$$;

create or replace function public.get_live_timers()
returns table (
  checkin_id bigint,
  customer_id uuid,
  customer_name text,
  customer_code text,
  is_inside boolean,
  resource_name text,
  checked_in_at timestamptz,
  deadline timestamptz,
  warning_at timestamptz,
  overdue_at timestamptz,
  state text,
  seconds_left integer,
  fees_due numeric,
  server_now timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  w integer := public.ops_num('ops.timer_window_minutes', 180)::integer;
  wr integer := public.ops_num('ops.timer_warning_minutes', 15)::integer;
begin
  if not coalesce(public.has_permission('timers.view'), false) then
    raise exception 'not allowed';
  end if;

  return query
  select
    k.id,
    c.id,
    c.first_name || ' ' || c.last_name,
    c.code,
    true,
    r.name,
    k.checked_in_at,
    d.deadline,
    d.deadline - make_interval(mins => wr),
    d.deadline,
    case
      when now() >= d.deadline then 'overdue'
      when now() >= d.deadline - make_interval(mins => wr) then 'warning'
      else 'ok'
    end,
    extract(epoch from (d.deadline - now()))::integer,
    case
      when public.has_permission('fees.view') then coalesce((
        select sum(f.amount)
        from public.fees f
        where f.checkin_id = k.id
          and f.status = 'due'
      ), 0)
      else 0
    end,
    now()
  from public.checkins k
  join public.customers c on c.id = k.customer_id
  left join public.resources r on r.id = k.resource_id
  cross join lateral (
    select greatest(
      k.timer_started_at,
      coalesce(k.last_qualifying_order_at, k.timer_started_at)
    ) + make_interval(mins => w) as deadline
  ) d
  where k.checked_out_at is null
  order by d.deadline;
end;
$$;

create or replace function public.waive_fee(p_fee uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(public.has_permission('fees.waive'), false) then
    raise exception 'not allowed';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'reason required';
  end if;

  update public.fees
  set status = 'waived',
      waived_by = auth.uid(),
      waive_reason = btrim(p_reason)
  where id = p_fee
    and status = 'due';

  if not found then
    raise exception 'fee not found or not due';
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(),
    'fee.waive',
    'fee',
    p_fee::text,
    jsonb_build_object('reason', btrim(p_reason))
  );
end;
$$;

drop function if exists public.check_out(uuid);

create or replace function public.check_out(p_checkin bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_due numeric(10, 2);
begin
  if not coalesce(public.has_permission('checkins.manage'), false) then
    raise exception 'not allowed';
  end if;

  perform public.accrue_fees(p_checkin);

  update public.checkins
  set checked_out_at = now(),
      closed_by = auth.uid()
  where id = p_checkin
    and checked_out_at is null
  returning customer_id into v_customer_id;

  if not found then
    raise exception 'visit not found or already closed';
  end if;

  select coalesce(sum(amount), 0)
  into v_due
  from public.fees
  where customer_id = v_customer_id
    and status = 'due';

  return jsonb_build_object(
    'customer_id', v_customer_id,
    'fees_due', v_due
  );
end;
$$;

revoke execute on function public.accrue_fees(bigint) from public, anon, authenticated;
revoke execute on function public.run_timer_job() from public, anon, authenticated;
revoke execute on function public.get_live_timers() from public, anon;
revoke execute on function public.waive_fee(uuid, text) from public, anon;
revoke execute on function public.check_out(bigint) from public, anon;

grant execute on function public.get_live_timers() to authenticated;
grant execute on function public.waive_fee(uuid, text) to authenticated;
grant execute on function public.check_out(bigint) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'fees'
  ) then
    alter publication supabase_realtime add table public.fees;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from cron.job
    where jobname = 'zatona-timer'
  ) then
    perform cron.schedule(
      'zatona-timer',
      '* * * * *',
      'select public.run_timer_job()'
    );
  end if;
end;
$$;

commit;
