begin;

create function public.list_audit_logs_sorted(
  p_user uuid default null,
  p_action text default null,
  p_entity text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_search text default null,
  p_sort text default 'newest',
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
        or concat_ws(' ', a.id::text, a.actor_id::text, a.action, a.entity, a.entity_id, p.first_name, p.last_name,
                     a.old_value::text, a.new_value::text) ilike '%' || btrim(p_search) || '%'
      )
  ), page as (
    select * from filtered
    order by
      case when p_sort = 'oldest' then created_at end asc,
      case when p_sort = 'name' then lower(coalesce(actor_name, '')) end asc,
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
        case when p_sort = 'name' then lower(coalesce(page.actor_name, '')) end asc,
        case when p_sort <> 'oldest' then page.created_at end desc,
        page.id desc
      ) from page),
      '[]'::jsonb
    )
  ) into result;
  return result;
end $$;

revoke execute on function public.list_audit_logs_sorted(uuid, text, text, timestamptz, timestamptz, text, text, int, int) from public, anon;
grant execute on function public.list_audit_logs_sorted(uuid, text, text, timestamptz, timestamptz, text, text, int, int) to authenticated;

commit;
