begin;

create function public.list_audit_scans_sorted(
  p_result text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_search text default null,
  p_sort text default 'newest',
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not public.has_permission('audit.view') then
    raise exception 'not allowed';
  end if;
  if p_result is not null and p_result not in ('ok', 'blocked', 'expired', 'unknown') then
    raise exception 'invalid scan result';
  end if;
  if p_sort is null or p_sort not in ('newest', 'oldest', 'name') then
    raise exception 'invalid sort order';
  end if;
  if p_from is not null and p_to is not null and p_to <= p_from then
    raise exception 'invalid date range';
  end if;
  if p_from is not null and p_to is not null and p_to - p_from > interval '400 days' then
    raise exception 'date range too large';
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
    where (p_result is null or l.result = p_result)
      and (p_from is null or l.created_at >= p_from)
      and (p_to is null or l.created_at < p_to)
      and (
        nullif(btrim(p_search), '') is null
        or l.id::text ilike '%' || btrim(p_search) || '%'
        or l.user_id::text ilike '%' || btrim(p_search) || '%'
        or l.result ilike '%' || btrim(p_search) || '%'
        or concat_ws(' ', employee.first_name, employee.last_name)
          ilike '%' || btrim(p_search) || '%'
        or (
          public.has_permission('customers.view')
          and (
            l.customer_id::text ilike '%' || btrim(p_search) || '%'
            or concat_ws(' ', customer.first_name, customer.last_name)
              ilike '%' || btrim(p_search) || '%'
          )
        )
      )
  ), page as (
    select * from filtered
    order by
      case when p_sort = 'oldest' then created_at end asc,
      case when p_sort = 'name' then lower(coalesce(employee_name, '')) end asc,
      case when p_sort <> 'oldest' then created_at end desc,
      id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 5000)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total_count', (select count(*) from filtered),
    'rows', coalesce(
      (select jsonb_agg(to_jsonb(page) order by
        case when p_sort = 'oldest' then page.created_at end asc,
        case when p_sort = 'name' then lower(coalesce(page.employee_name, '')) end asc,
        case when p_sort <> 'oldest' then page.created_at end desc,
        page.id desc
      ) from page),
      '[]'::jsonb
    )
  ) into result;
  return result;
end;
$$;

revoke execute on function public.list_audit_scans_sorted(text, timestamptz, timestamptz, text, text, int, int)
  from public, anon;
grant execute on function public.list_audit_scans_sorted(text, timestamptz, timestamptz, text, text, int, int)
  to authenticated;

commit;
