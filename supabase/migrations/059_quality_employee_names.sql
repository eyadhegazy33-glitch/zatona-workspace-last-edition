begin;

create or replace function public.get_qc_employee_names(p_user_ids uuid[])
returns table (user_id uuid, first_name text, last_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  if not public.has_permission('qc.review') and exists (
    select 1 from unnest(coalesce(p_user_ids, '{}')) requested(user_id)
    where requested.user_id <> auth.uid()
  ) then
    raise exception 'not allowed';
  end if;
  return query
  select p.id, p.first_name, p.last_name
  from public.profiles p
  where p.id = any(coalesce(p_user_ids, '{}'));
end $$;
revoke execute on function public.get_qc_employee_names(uuid[]) from public, anon;
grant execute on function public.get_qc_employee_names(uuid[]) to authenticated;

commit;
