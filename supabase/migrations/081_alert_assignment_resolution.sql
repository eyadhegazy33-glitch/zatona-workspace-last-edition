alter table public.alerts
  add column if not exists resolved_by uuid references public.profiles(id),
  add column if not exists manual_resolution boolean not null default false;

insert into public.permissions (key, description)
values ('alerts.view_assigned', 'View only alerts assigned to the current user')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select id, 'alerts.view_assigned'
from public.roles
on conflict do nothing;

drop policy if exists alerts_read on public.alerts;
create policy alerts_read on public.alerts for select to authenticated
  using (
    public.has_permission('alerts.view')
    or (
      public.has_permission('alerts.view_assigned')
      and assigned_to = auth.uid()
    )
  );

create or replace function public.assign_alert(p_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old_assignee uuid;
  v_status text;
begin
  if auth.uid() is null or not public.has_permission('alerts.manage') then
    raise exception 'not allowed';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_user and status = 'active' and deleted_at is null
  ) then
    raise exception 'active staff member required';
  end if;

  select assigned_to, status into v_old_assignee, v_status
  from public.alerts where id = p_id for update;
  if not found or v_status = 'resolved' then
    raise exception 'alert not found or resolved';
  end if;

  update public.alerts
  set assigned_to = p_user,
      status = 'acknowledged',
      acknowledged_by = coalesce(acknowledged_by, auth.uid()),
      acknowledged_at = coalesce(acknowledged_at, now()),
      snoozed_until = null
  where id = p_id;

  if v_old_assignee is distinct from p_user then
    insert into public.notifications (user_id, type, payload)
    values (p_user, 'alert_assigned', jsonb_build_object('alert_id', p_id));
  end if;
end $$;

create or replace function public.resolve_alert(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_assignee uuid;
  v_status text;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;

  select assigned_to, status into v_assignee, v_status
  from public.alerts where id = p_id for update;
  if not found or v_status = 'resolved' then
    raise exception 'alert not found or already resolved';
  end if;
  if v_assignee is distinct from auth.uid()
     and not public.has_permission('alerts.manage') then
    raise exception 'only the assigned staff member may resolve this alert';
  end if;

  update public.alerts
  set status = 'resolved',
      resolved_at = now(),
      resolved_by = auth.uid(),
      manual_resolution = true,
      snoozed_until = null
  where id = p_id;
end $$;

create or replace function public.get_alert_shift_session(p_session uuid)
returns table (
  session_id uuid,
  employee_name text,
  shift_name text,
  opened_at timestamptz,
  closed_at timestamptz,
  opening_cash numeric,
  closing_cash numeric,
  cash_expected numeric,
  cash_counted numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (
    public.has_permission('alerts.view')
    or exists (
      select 1 from public.alerts a
      where a.type in ('shift_open', 'cash_difference')
        and a.detail->>'session_id' = p_session::text
        and a.assigned_to = auth.uid()
        and a.status in ('open', 'acknowledged', 'snoozed')
    )
  ) then
    raise exception 'not allowed';
  end if;

  return query
  select ss.id,
         nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
         sh.name,
         ss.opened_at,
         ss.closed_at,
         ss.opening_cash,
         ss.closing_cash,
         ss.cash_expected,
         ss.cash_counted
  from public.shift_sessions ss
  left join public.profiles p on p.id = ss.user_id
  left join public.shifts sh on sh.id = ss.shift_id
  where ss.id = p_session;
end $$;

create or replace function public.get_alert_scan_log(p_alert uuid)
returns table (scan_id bigint, created_at timestamptz, result text)
language plpgsql stable security definer set search_path = public as $$
declare alert_created timestamptz;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;

  select a.created_at into alert_created
  from public.alerts a
  where a.id = p_alert
    and a.type = 'scan_failures'
    and (
      public.has_permission('alerts.view')
      or (
        a.assigned_to = auth.uid()
        and a.status in ('open', 'acknowledged', 'snoozed')
      )
    );
  if not found then raise exception 'scan alert not found'; end if;

  return query
  select l.id, l.created_at, l.result
  from public.scan_logs l
  where l.result <> 'ok'
    and l.created_at between alert_created - interval '10 minutes'
                         and alert_created + interval '10 minutes'
  order by l.created_at desc
  limit 100;
end $$;

create or replace function public.generate_alerts()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.alerts a
  set manual_resolution = false
  where a.status = 'resolved'
    and a.manual_resolution
    and not exists (
      select 1 from public.current_alert_candidates() c
      where c.source_key = a.source_key
    );

  insert into public.alerts (type, severity, title, source_key, detail)
  select c.type, c.severity, c.title, c.source_key, c.detail
  from public.current_alert_candidates() c
  where not exists (
    select 1 from public.alerts a
    where a.source_key = c.source_key
      and a.status = 'resolved'
      and a.manual_resolution
  )
  on conflict (source_key) where status in ('open','acknowledged','snoozed') do nothing;

  update public.alerts a
  set status = 'resolved', resolved_at = now()
  where a.status in ('open','acknowledged','snoozed')
    and not exists (
      select 1 from public.current_alert_candidates() c
      where c.source_key = a.source_key
    );

  update public.alerts
  set status = 'open', snoozed_until = null
  where status = 'snoozed' and snoozed_until <= now();
end $$;

revoke execute on function public.assign_alert(uuid, uuid) from public, anon;
revoke execute on function public.resolve_alert(uuid) from public, anon;
grant execute on function public.assign_alert(uuid, uuid) to authenticated;
grant execute on function public.resolve_alert(uuid) to authenticated;
