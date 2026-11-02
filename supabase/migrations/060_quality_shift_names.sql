begin;

create or replace function public.get_qc_shift_names(p_shift_session_ids uuid[])
returns table (shift_session_id uuid, shift_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  if not public.has_permission('qc.review') and exists (
    select 1
    from unnest(coalesce(p_shift_session_ids, '{}')) requested(session_id)
    left join public.shift_sessions ss on ss.id = requested.session_id
    where ss.user_id is distinct from auth.uid()
  ) then
    raise exception 'not allowed';
  end if;
  return query
  select ss.id, sh.name
  from public.shift_sessions ss
  left join public.shifts sh on sh.id = ss.shift_id
  where ss.id = any(coalesce(p_shift_session_ids, '{}'));
end $$;
revoke execute on function public.get_qc_shift_names(uuid[]) from public, anon;
grant execute on function public.get_qc_shift_names(uuid[]) to authenticated;

commit;
