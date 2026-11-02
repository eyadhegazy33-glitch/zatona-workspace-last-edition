begin;

create index if not exists scan_logs_created_result_idx
  on public.scan_logs (created_at desc, result);

create or replace function public.audit_log_actions()
returns table (action text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_permission('audit.view') then
    raise exception 'not allowed';
  end if;
  return query
  select distinct a.action
  from public.audit_logs a
  order by a.action;
end $$;

create or replace function public.list_audit_logs(
  p_user uuid default null,
  p_action text default null,
  p_entity text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not public.has_permission('audit.view') then
    raise exception 'not allowed';
  end if;
  if p_from is not null and p_to is not null and p_to <= p_from then
    raise exception 'invalid date range';
  end if;
  if p_from is not null and p_to is not null and p_to - p_from > interval '400 days' then
    raise exception 'date range too large';
  end if;

  with filtered as (
    select a.id, a.created_at, a.actor_id,
           nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as actor_name,
           coalesce(a.actor_role, r.name) as actor_role,
           a.action, a.entity, a.entity_id, a.old_value, a.new_value,
           a.ip, a.user_agent
    from public.audit_logs a
    left join public.profiles p on p.id = a.actor_id
    left join public.roles r on r.id = p.role_id
    where (p_user is null or a.actor_id = p_user)
      and (nullif(btrim(p_action), '') is null or a.action = p_action)
      and (nullif(btrim(p_entity), '') is null or a.entity = p_entity)
      and (p_from is null or a.created_at >= p_from)
      and (p_to is null or a.created_at < p_to)
      and (
        nullif(btrim(p_search), '') is null
        or concat_ws(' ', a.action, a.entity, a.entity_id, p.first_name, p.last_name,
                     a.old_value::text, a.new_value::text) ilike '%' || btrim(p_search) || '%'
      )
  ), page as (
    select * from filtered
    order by created_at desc, id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 5000)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total_count', (select count(*) from filtered),
    'rows', coalesce(
      (select jsonb_agg(to_jsonb(page) order by page.created_at desc, page.id desc) from page),
      '[]'::jsonb
    )
  ) into result;
  return result;
end $$;

create or replace function public.list_audit_scans(
  p_result text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not public.has_permission('audit.view') then
    raise exception 'not allowed';
  end if;
  if p_result is not null and p_result not in ('ok', 'blocked', 'expired', 'unknown') then
    raise exception 'invalid scan result';
  end if;

  with filtered as (
    select l.id, l.created_at, l.result, l.user_id,
           nullif(trim(concat_ws(' ', employee.first_name, employee.last_name)), '') as employee_name,
           (l.customer_id is not null) as customer_known,
           case when public.has_permission('customers.view')
             then nullif(trim(concat_ws(' ', customer.first_name, customer.last_name)), '')
             else null
           end as customer_name
    from public.scan_logs l
    left join public.profiles employee on employee.id = l.user_id
    left join public.customers customer on customer.id = l.customer_id
    where p_result is null or l.result = p_result
  ), page as (
    select * from filtered
    order by created_at desc, id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 5000)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total_count', (select count(*) from filtered),
    'rows', coalesce(
      (select jsonb_agg(to_jsonb(page) order by page.created_at desc, page.id desc) from page),
      '[]'::jsonb
    )
  ) into result;
  return result;
end $$;

drop function public.audit_suspicious(int);
create function public.audit_suspicious(p_days int default 7)
returns table (
  id bigint,
  created_at timestamptz,
  actor_id uuid,
  actor_name text,
  actor_role text,
  action text,
  entity text,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  ip text,
  user_agent text
)
language plpgsql security definer stable set search_path = public as $$
declare
  tz text := public.ops_text('ops.timezone', 'Africa/Cairo');
begin
  if auth.uid() is null or not public.has_permission('audit.view') then
    raise exception 'not allowed';
  end if;
  return query
  select a.id, a.created_at, a.actor_id,
         nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
         coalesce(a.actor_role, r.name), a.action, a.entity, a.entity_id,
         a.old_value, a.new_value, a.ip, a.user_agent
  from public.audit_logs a
  left join public.profiles p on p.id = a.actor_id
  left join public.roles r on r.id = p.role_id
  where a.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 30))
    and (
      a.action ilike any (array['%void%', '%waive%', '%rollback%', '%reissue%', '%permission%', '%role%'])
      or (
        a.action ilike any (array['%delete%', '%approve%', '%setting%', '%suspend%'])
        and extract(hour from a.created_at at time zone tz) between 0 and 5
      )
    )
  order by a.created_at desc
  limit 500;
end $$;

revoke execute on function public.audit_log_actions() from public, anon;
revoke execute on function public.list_audit_logs(uuid, text, text, timestamptz, timestamptz, text, int, int) from public, anon;
revoke execute on function public.list_audit_scans(text, int, int) from public, anon;
revoke execute on function public.audit_suspicious(int) from public, anon;

grant execute on function public.audit_log_actions() to authenticated;
grant execute on function public.list_audit_logs(uuid, text, text, timestamptz, timestamptz, text, int, int) to authenticated;
grant execute on function public.list_audit_scans(text, int, int) to authenticated;
grant execute on function public.audit_suspicious(int) to authenticated;

commit;
