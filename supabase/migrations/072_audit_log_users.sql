create or replace function public.audit_log_users()
returns table (user_id uuid, display_name text, role_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_permission('audit.view') then
    raise exception 'not allowed';
  end if;

  return query
  select distinct a.actor_id,
         coalesce(
           nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
           a.actor_id::text
         ),
         coalesce(a.actor_role, r.name)
  from public.audit_logs a
  left join public.profiles p on p.id = a.actor_id
  left join public.roles r on r.id = p.role_id
  where a.actor_id is not null
  order by 2;
end $$;

revoke execute on function public.audit_log_users() from public, anon;
grant execute on function public.audit_log_users() to authenticated;
