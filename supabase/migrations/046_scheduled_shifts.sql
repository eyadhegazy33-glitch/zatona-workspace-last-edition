begin;

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  start_time time not null,
  end_time time not null,
  days integer[] not null default array[0, 1, 2, 3, 4, 5, 6],
  active boolean not null default true,
  constraint shifts_days_valid check (
    cardinality(days) between 1 and 7
    and days <@ array[0, 1, 2, 3, 4, 5, 6]
  )
);

create table if not exists public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id),
  user_id uuid not null references public.profiles(id),
  work_date date not null
);

alter table public.shift_assignments
  add column if not exists canceled_at timestamptz;
alter table public.shift_assignments
  drop constraint if exists shift_assignments_shift_id_user_id_work_date_key;

create table if not exists public.shift_swap_requests (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.shift_assignments(id),
  requester_id uuid not null references public.profiles(id),
  target_user_id uuid not null references public.profiles(id),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint shift_swap_not_self check (requester_id <> target_user_id),
  constraint shift_swap_decision_state check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status <> 'pending' and decided_by is not null and decided_at is not null)
  )
);

create index if not exists shift_assignments_date_idx
  on public.shift_assignments(work_date, shift_id)
  where canceled_at is null;
create index if not exists shift_assignments_user_date_idx
  on public.shift_assignments(user_id, work_date)
  where canceled_at is null;
create unique index if not exists shift_assignments_active_unique_idx
  on public.shift_assignments(shift_id, user_id, work_date)
  where canceled_at is null;
create index if not exists shift_swap_requests_pending_idx
  on public.shift_swap_requests(assignment_id, created_at)
  where status = 'pending';

alter table public.shifts enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.shift_swap_requests enable row level security;

drop policy if exists shifts_read on public.shifts;
drop policy if exists shifts_write on public.shifts;
create policy shifts_read on public.shifts for select to authenticated
  using (public.has_permission('shifts.use') or public.has_permission('shifts.manage'));

drop policy if exists assignments_read on public.shift_assignments;
drop policy if exists assignments_write on public.shift_assignments;
create policy assignments_read on public.shift_assignments for select to authenticated
  using (user_id = auth.uid() or public.has_permission('shifts.manage'));

drop policy if exists swaps_read on public.shift_swap_requests;
create policy swaps_read on public.shift_swap_requests for select to authenticated
  using (
    requester_id = auth.uid()
    or target_user_id = auth.uid()
    or public.has_permission('shifts.manage')
  );

revoke all on public.shifts, public.shift_assignments, public.shift_swap_requests from anon;
revoke all on public.shifts, public.shift_assignments,
  public.shift_swap_requests from authenticated;
grant select on public.shifts, public.shift_assignments,
  public.shift_swap_requests to authenticated;

alter table public.pos_shifts
  add column if not exists schedule_shift_id uuid references public.shifts(id);

insert into public.permissions (key, description) values
  ('shifts.manage', 'Create shifts, assign staff, decide swap requests, close any shift'),
  ('shifts.use', 'Open and close your own shift')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, 'shifts.use'
from public.roles r
where r.name in ('Admin', 'Manager', 'Reception', 'Barista')
on conflict (role_id, permission_key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, 'shifts.manage'
from public.roles r
where r.name in ('Admin', 'Manager')
on conflict (role_id, permission_key) do nothing;

create or replace function public.get_shift_schedule_data(
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_manage boolean := coalesce(public.has_permission('shifts.manage'), false);
  v_result jsonb;
begin
  if not v_manage and not coalesce(public.has_permission('shifts.use'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to > p_from + 60 then
    raise exception using errcode = '22023', message = 'invalid schedule date range';
  end if;

  select jsonb_build_object(
    'shifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'start_time', s.start_time,
        'end_time', s.end_time,
        'days', to_jsonb(s.days),
        'active', s.active
      ) order by s.start_time, s.name)
      from public.shifts s
      where v_manage or s.active
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'shift_id', s.id,
        'shift_name', s.name,
        'start_time', s.start_time,
        'end_time', s.end_time,
        'work_date', a.work_date,
        'user_id', a.user_id,
        'user_name', concat_ws(' ', p.first_name, p.last_name)
      ) order by a.work_date, s.start_time, p.first_name, p.last_name)
      from public.shift_assignments a
      join public.shifts s on s.id = a.shift_id
      join public.profiles p on p.id = a.user_id
      where a.work_date between p_from and p_to
        and a.canceled_at is null
        and (v_manage or a.user_id = auth.uid())
    ), '[]'::jsonb),
    'team', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', concat_ws(' ', p.first_name, p.last_name)
      ) order by p.first_name, p.last_name)
      from public.profiles p
      where p.status::text = 'active'
        and p.deleted_at is null
        and p.role_id is not null
    ), '[]'::jsonb),
    'swap_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', request.id,
        'assignment_id', request.assignment_id,
        'requester_id', request.requester_id,
        'requester_name', concat_ws(' ', requester.first_name, requester.last_name),
        'target_user_id', request.target_user_id,
        'target_name', concat_ws(' ', target.first_name, target.last_name),
        'status', request.status,
        'created_at', request.created_at,
        'work_date', assignment.work_date,
        'shift_name', shift.name
      ) order by request.created_at)
      from public.shift_swap_requests request
      join public.shift_assignments assignment on assignment.id = request.assignment_id
      join public.shifts shift on shift.id = assignment.shift_id
      join public.profiles requester on requester.id = request.requester_id
      join public.profiles target on target.id = request.target_user_id
      where (v_manage or request.requester_id = auth.uid() or request.target_user_id = auth.uid())
        and request.status = 'pending'
        and assignment.canceled_at is null
        and assignment.work_date between p_from and p_to
    ), '[]'::jsonb)
  )
  into v_result;
  return v_result;
end;
$$;

create or replace function public.save_scheduled_shift(
  p_id uuid,
  p_name text,
  p_start_time time,
  p_end_time time,
  p_days integer[],
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_old public.shifts;
begin
  if not coalesce(public.has_permission('shifts.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80
     or p_start_time is null or p_end_time is null
     or p_start_time = p_end_time
     or p_days is null or cardinality(p_days) = 0
     or exists (select 1 from unnest(p_days) day where day not between 0 and 6)
     or p_active is null then
    raise exception using errcode = '22023', message = 'invalid shift details';
  end if;

  if p_id is null then
    insert into public.shifts (name, start_time, end_time, days, active)
    values (btrim(p_name), p_start_time, p_end_time, p_days, p_active)
    returning id into v_id;
  else
    select * into v_old
    from public.shifts
    where id = p_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'shift not found';
    end if;
    update public.shifts
    set name = btrim(p_name),
        start_time = p_start_time,
        end_time = p_end_time,
        days = p_days,
        active = p_active
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception using errcode = 'P0002', message = 'shift not found';
    end if;
  end if;
  insert into public.audit_logs (actor_id, action, entity, entity_id, old_value, new_value)
  values (
    auth.uid(), 'shift.schedule.save', 'shift', v_id::text,
    case when p_id is null then null else to_jsonb(v_old) end,
    jsonb_build_object(
      'name', btrim(p_name),
      'start_time', p_start_time,
      'end_time', p_end_time,
      'days', p_days,
      'active', p_active
    )
  );
  return v_id;
end;
$$;

create or replace function public.assign_scheduled_shift(
  p_shift uuid,
  p_user uuid,
  p_work_date date
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_shift public.shifts;
  v_id uuid;
  v_inserted boolean;
begin
  if not coalesce(public.has_permission('shifts.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_user is null or p_work_date is null then
    raise exception using errcode = '22023', message = 'invalid shift assignment';
  end if;

  select * into v_shift
  from public.shifts
  where id = p_shift and active
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'active shift not found';
  end if;
  if not (extract(dow from p_work_date)::integer = any(v_shift.days)) then
    raise exception using errcode = '22023', message = 'shift is not scheduled for this weekday';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_user and status::text = 'active'
      and deleted_at is null and role_id is not null
  ) then
    raise exception using errcode = 'P0002', message = 'active employee not found';
  end if;

  insert into public.shift_assignments (shift_id, user_id, work_date)
  values (p_shift, p_user, p_work_date)
  on conflict (shift_id, user_id, work_date) where canceled_at is null do nothing
  returning id into v_id;
  v_inserted := found;
  if not v_inserted then
    select id into v_id
    from public.shift_assignments
    where shift_id = p_shift and user_id = p_user and work_date = p_work_date
      and canceled_at is null;
  else
    insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
    values (
      auth.uid(), 'shift.assignment.create', 'shift_assignment', v_id::text,
      jsonb_build_object('shift_id', p_shift, 'user_id', p_user, 'work_date', p_work_date)
    );
  end if;
  return v_id;
end;
$$;

create or replace function public.remove_scheduled_shift_assignment(p_assignment uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_assignment public.shift_assignments;
begin
  if not coalesce(public.has_permission('shifts.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  select * into v_assignment
  from public.shift_assignments
  where id = p_assignment and canceled_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'shift assignment not found';
  end if;
  if exists (
    select 1 from public.shift_swap_requests
    where assignment_id = p_assignment and status = 'pending'
  ) then
    raise exception using errcode = '55000', message = 'decide pending swap request first';
  end if;
  update public.shift_assignments
  set canceled_at = now()
  where id = p_assignment and canceled_at is null
  returning * into v_assignment;
  insert into public.audit_logs (actor_id, action, entity, entity_id, old_value, new_value)
  values (
    auth.uid(), 'shift.assignment.cancel', 'shift_assignment', p_assignment::text,
    to_jsonb(v_assignment) - 'canceled_at',
    to_jsonb(v_assignment)
  );
end;
$$;

create or replace function public.request_swap(p_assignment uuid, p_target uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_assignment public.shift_assignments;
  v_timezone text;
begin
  if not coalesce(public.has_permission('shifts.use'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_target is null or p_target = auth.uid() then
    raise exception using errcode = '22023', message = 'choose another employee';
  end if;

  select * into v_assignment
  from public.shift_assignments
  where id = p_assignment and user_id = auth.uid()
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'this is not your shift';
  end if;
  select coalesce(
    (select value #>> '{}' from public.settings where key = 'ops.time_zone'),
    (select value #>> '{}' from public.settings where key = 'ops.timezone'),
    'Africa/Cairo'
  ) into v_timezone;
  if v_assignment.canceled_at is not null
     or v_assignment.work_date < timezone(v_timezone, now())::date then
    raise exception using errcode = '22023', message = 'past shifts cannot be swapped';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_target and status::text = 'active'
      and deleted_at is null and role_id is not null
  ) then
    raise exception using errcode = 'P0002', message = 'target employee not found';
  end if;
  if exists (
    select 1 from public.shift_swap_requests
    where assignment_id = p_assignment and status = 'pending'
  ) then
    raise exception using errcode = '23505', message = 'swap request already pending';
  end if;

  insert into public.shift_swap_requests (
    assignment_id, requester_id, target_user_id
  ) values (p_assignment, auth.uid(), p_target);
  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'shift.swap.request', 'shift_assignment', p_assignment::text,
    jsonb_build_object('target_user_id', p_target)
  );
end;
$$;

create or replace function public.decide_swap(p_request uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_request public.shift_swap_requests;
  v_assignment public.shift_assignments;
begin
  if not coalesce(public.has_permission('shifts.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_approve is null then
    raise exception using errcode = '22023', message = 'decision is required';
  end if;

  select * into v_request
  from public.shift_swap_requests
  where id = p_request and status = 'pending'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'request not found or already decided';
  end if;

  select * into v_assignment
  from public.shift_assignments
  where id = v_request.assignment_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'shift assignment not found';
  end if;
  if v_assignment.canceled_at is not null then
    raise exception using errcode = '55000', message = 'shift assignment has been canceled';
  end if;
  if p_approve then
    if v_assignment.user_id <> v_request.requester_id then
      raise exception using errcode = '55000', message = 'shift assignment has changed';
    end if;
    if exists (
      select 1 from public.shift_assignments
      where shift_id = v_assignment.shift_id
        and work_date = v_assignment.work_date
        and user_id = v_request.target_user_id
        and canceled_at is null
        and id <> v_assignment.id
    ) then
      raise exception using errcode = '23505', message = 'employee already has this shift';
    end if;
    update public.shift_assignments
    set user_id = v_request.target_user_id
    where id = v_assignment.id;
  end if;

  update public.shift_swap_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = auth.uid(),
      decided_at = now()
  where id = p_request;
  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), case when p_approve then 'shift.swap.approve' else 'shift.swap.reject' end,
    'shift_swap_request', p_request::text,
    jsonb_build_object('assignment_id', v_assignment.id, 'target_user_id', v_request.target_user_id)
  );
end;
$$;

create or replace function public.get_current_pos_shift()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_shift public.pos_shifts;
begin
  if not coalesce(public.has_permission('shifts.use'), false)
     and not coalesce(public.has_permission('shifts.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select * into v_shift
  from public.pos_shifts
  where user_id = auth.uid() and closed_at is null
  limit 1;
  if not found then
    return jsonb_build_object('shift', null, 'server_now', now());
  end if;
  return jsonb_build_object(
    'shift',
    to_jsonb(v_shift) || jsonb_build_object(
      'schedule_shift_name',
      (select schedule.name from public.shifts schedule where schedule.id = v_shift.schedule_shift_id)
    ),
    'server_now', now()
  );
end;
$$;

drop function if exists public.open_pos_shift(numeric);

create function public.open_pos_shift(
  p_opening_cash numeric,
  p_schedule_shift uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_shift public.pos_shifts;
  v_currency text;
  v_timezone text;
  v_work_date date;
  v_schedule_shift uuid := p_schedule_shift;
  v_assignment_count integer;
begin
  if not coalesce(public.has_permission('shifts.use'), false)
     and not coalesce(public.has_permission('shifts.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_opening_cash is null or p_opening_cash < 0 or p_opening_cash > 100000000 then
    raise exception using errcode = '22023', message = 'invalid opening cash';
  end if;
  if exists (select 1 from public.pos_shifts where user_id = auth.uid() and closed_at is null) then
    raise exception using errcode = '23505', message = 'shift already open';
  end if;

  select coalesce(
    (select value #>> '{}' from public.settings where key = 'ops.time_zone'),
    (select value #>> '{}' from public.settings where key = 'ops.timezone'),
    'Africa/Cairo'
  ) into v_timezone;
  v_work_date := timezone(v_timezone, now())::date;

  if v_schedule_shift is null then
    select count(*) into v_assignment_count
    from public.shift_assignments assignment
    join public.shifts schedule on schedule.id = assignment.shift_id and schedule.active
    where assignment.user_id = auth.uid()
      and assignment.canceled_at is null
      and assignment.work_date = v_work_date;
    if v_assignment_count = 1 then
      select assignment.shift_id into v_schedule_shift
      from public.shift_assignments assignment
      join public.shifts schedule on schedule.id = assignment.shift_id and schedule.active
      where assignment.user_id = auth.uid()
        and assignment.canceled_at is null
        and assignment.work_date = v_work_date;
    elsif v_assignment_count > 1 then
      raise exception using errcode = '22023', message = 'choose assigned shift';
    end if;
  else
    if not exists (
      select 1
      from public.shift_assignments assignment
      join public.shifts schedule on schedule.id = assignment.shift_id and schedule.active
      where assignment.user_id = auth.uid()
        and assignment.canceled_at is null
        and assignment.work_date = v_work_date
        and assignment.shift_id = v_schedule_shift
    ) then
      raise exception using errcode = '42501', message = 'shift is not assigned to you today';
    end if;
  end if;

  select value #>> '{}' into v_currency
  from public.settings
  where key = 'ops.currency'
  for share;

  insert into public.pos_shifts (user_id, opening_cash, schedule_shift_id)
  values (auth.uid(), round(p_opening_cash, 2), v_schedule_shift)
  returning * into v_shift;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'pos.shift.open', 'pos_shift', v_shift.id::text,
    jsonb_build_object(
      'opening_cash', v_shift.opening_cash,
      'currency', coalesce(v_currency, 'EGP'),
      'schedule_shift_id', v_schedule_shift
    )
  );
  return jsonb_build_object(
    'shift', to_jsonb(v_shift),
    'currency', coalesce(v_currency, 'EGP'),
    'server_now', now()
  );
end;
$$;

create or replace function public.close_pos_shift(p_shift uuid, p_counted_cash numeric)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_shift public.pos_shifts;
  v_cash_sales numeric(12, 2);
  v_expected numeric(12, 2);
  v_alert numeric(12, 2);
begin
  if not coalesce(public.has_permission('shifts.use'), false)
     and not coalesce(public.has_permission('shifts.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_counted_cash is null or p_counted_cash < 0 or p_counted_cash > 100000000 then
    raise exception using errcode = '22023', message = 'invalid closing cash';
  end if;
  select * into v_shift
  from public.pos_shifts
  where id = p_shift and closed_at is null
    and (user_id = auth.uid() or public.has_permission('shifts.manage'))
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'open shift not found';
  end if;
  if exists (
    select 1 from public.pos_orders
    where shift_id = p_shift and status in ('open', 'new', 'preparing', 'ready', 'served')
  ) or exists (
    select 1 from public.visit_fees f
    where f.shift_id = p_shift
      and not exists (select 1 from public.visit_fee_waivers w where w.fee_id = f.id)
      and not exists (
        select 1 from public.pos_receipts r
        where r.fee_id = f.id and not exists (
          select 1 from public.pos_receipt_voids x where x.receipt_id = r.id
        )
      )
  ) then
    raise exception using errcode = '55000', message = 'shift has pending orders or fees';
  end if;

  select coalesce(sum(r.total), 0)::numeric(12, 2)
  into v_cash_sales
  from public.pos_receipts r
  where r.shift_id = v_shift.id and r.payment_method = 'cash'
    and not exists (select 1 from public.pos_receipt_voids x where x.receipt_id = r.id);
  v_expected := v_shift.opening_cash + v_cash_sales;
  select coalesce((value #>> '{}')::numeric, 50)
  into v_alert from public.settings where key = 'ops.cash_diff_alert';

  update public.pos_shifts
  set closed_at = now(), counted_cash = round(p_counted_cash, 2),
      expected_cash = v_expected, variance = round(p_counted_cash, 2) - v_expected
  where id = v_shift.id returning * into v_shift;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'pos.shift.close', 'pos_shift', v_shift.id::text,
    jsonb_build_object(
      'counted_cash', v_shift.counted_cash, 'expected_cash', v_shift.expected_cash,
      'variance', v_shift.variance, 'cash_diff_alert', abs(v_shift.variance) >= coalesce(v_alert, 50)
    )
  );
  return jsonb_build_object(
    'shift', to_jsonb(v_shift),
    'cash_diff_alert', abs(v_shift.variance) >= coalesce(v_alert, 50),
    'server_now', now()
  );
end;
$$;

revoke all on function public.get_shift_schedule_data(date, date) from public, anon;
revoke all on function public.save_scheduled_shift(uuid, text, time, time, integer[], boolean) from public, anon;
revoke all on function public.assign_scheduled_shift(uuid, uuid, date) from public, anon;
revoke all on function public.remove_scheduled_shift_assignment(uuid) from public, anon;
revoke all on function public.request_swap(uuid, uuid) from public, anon;
revoke all on function public.decide_swap(uuid, boolean) from public, anon;
revoke all on function public.get_current_pos_shift() from public, anon;
revoke all on function public.open_pos_shift(numeric, uuid) from public, anon;
revoke all on function public.close_pos_shift(uuid, numeric) from public, anon;

grant execute on function public.get_shift_schedule_data(date, date) to authenticated;
grant execute on function public.save_scheduled_shift(uuid, text, time, time, integer[], boolean) to authenticated;
grant execute on function public.assign_scheduled_shift(uuid, uuid, date) to authenticated;
grant execute on function public.remove_scheduled_shift_assignment(uuid) to authenticated;
grant execute on function public.request_swap(uuid, uuid) to authenticated;
grant execute on function public.decide_swap(uuid, boolean) to authenticated;
grant execute on function public.get_current_pos_shift() to authenticated;
grant execute on function public.open_pos_shift(numeric, uuid) to authenticated;
grant execute on function public.close_pos_shift(uuid, numeric) to authenticated;

commit;
