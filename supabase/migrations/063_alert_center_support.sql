create or replace function public.get_alert_overview()
returns table (
  active_count bigint,
  low_count bigint,
  medium_count bigint,
  high_count bigint,
  critical_count bigint,
  critical_unacknowledged boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_permission('alerts.view') then
    raise exception 'not allowed';
  end if;
  return query
  select
    count(*) filter (where a.status in ('open', 'acknowledged')),
    count(*) filter (where a.status in ('open', 'acknowledged') and a.severity = 'low'),
    count(*) filter (where a.status in ('open', 'acknowledged') and a.severity = 'medium'),
    count(*) filter (where a.status in ('open', 'acknowledged') and a.severity = 'high'),
    count(*) filter (where a.status in ('open', 'acknowledged') and a.severity = 'critical'),
    coalesce(bool_or(a.status = 'open' and a.severity = 'critical'), false)
  from public.alerts a;
end $$;

create or replace function public.get_alert_staff()
returns table (user_id uuid, first_name text, last_name text, role_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_permission('alerts.manage') then
    raise exception 'not allowed';
  end if;
  return query
  select p.id, p.first_name, p.last_name, r.name
  from public.profiles p
  left join public.roles r on r.id = p.role_id
  where p.status = 'active' and p.deleted_at is null
  order by p.first_name, p.last_name;
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
  if auth.uid() is null or not public.has_permission('alerts.view') then
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
  if auth.uid() is null or not public.has_permission('alerts.view') then
    raise exception 'not allowed';
  end if;
  select a.created_at into alert_created
  from public.alerts a
  where a.id = p_alert and a.type = 'scan_failures';
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

create or replace function public.assign_alert(p_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('alerts.manage') then raise exception 'not allowed'; end if;
  if not exists (
    select 1 from public.profiles
    where id = p_user and status = 'active' and deleted_at is null
  ) then
    raise exception 'active staff member required';
  end if;
  update public.alerts set assigned_to = p_user where id = p_id and status <> 'resolved';
  if not found then raise exception 'alert not found or resolved'; end if;
end $$;

revoke execute on function public.get_alert_overview() from public, anon;
revoke execute on function public.get_alert_staff() from public, anon;
revoke execute on function public.get_alert_shift_session(uuid) from public, anon;
revoke execute on function public.get_alert_scan_log(uuid) from public, anon;
revoke execute on function public.assign_alert(uuid, uuid) from public, anon;
grant execute on function public.get_alert_overview() to authenticated;
grant execute on function public.get_alert_staff() to authenticated;
grant execute on function public.get_alert_shift_session(uuid) to authenticated;
grant execute on function public.get_alert_scan_log(uuid) to authenticated;
grant execute on function public.assign_alert(uuid, uuid) to authenticated;
