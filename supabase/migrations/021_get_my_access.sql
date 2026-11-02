create or replace function public.get_my_access()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'first_name', p.first_name,
    'last_name', p.last_name,
    'email', p.email,
    'status', p.status,
    'reject_reason', p.reject_reason,
    'role_id', p.role_id,
    'role_name', r.name,
    'permissions',
      case
        when p.status = 'active' then coalesce(
          (
            select jsonb_agg(rp.permission_key order by rp.permission_key)
            from public.role_permissions rp
            where rp.role_id = p.role_id
          ),
          '[]'::jsonb
        )
        else '[]'::jsonb
      end
  )
  from public.profiles p
  left join public.roles r on r.id = p.role_id
  where p.id = auth.uid()
    and p.deleted_at is null;
$$;

revoke all on function public.get_my_access() from public, anon;
grant execute on function public.get_my_access() to authenticated;
