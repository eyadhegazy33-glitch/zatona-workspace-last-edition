create or replace function public.get_incident_timeline(p_id uuid)
returns table (
  event_id bigint,
  kind text,
  body text,
  created_at timestamptz,
  actor_name text,
  assigned_name text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.incidents i
    where i.id = p_id
      and (
        public.has_permission('incidents.view')
        or i.reported_by = auth.uid()
        or i.assigned_to = auth.uid()
      )
  ) then
    raise exception 'not allowed';
  end if;
  return query
  select e.id,
         e.kind,
         e.body,
         e.created_at,
         nullif(trim(concat_ws(' ', actor.first_name, actor.last_name)), ''),
         case when e.kind = 'assign' then nullif(trim(concat_ws(' ', assigned.first_name, assigned.last_name)), '') else null end
  from public.incident_events e
  left join public.profiles actor on actor.id = e.user_id
  left join public.profiles assigned
    on e.kind = 'assign'
   and e.body ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and assigned.id::text = e.body
  where e.incident_id = p_id
  order by e.created_at, e.id;
end $$;

revoke execute on function public.get_incident_timeline(uuid) from public, anon;
grant execute on function public.get_incident_timeline(uuid) to authenticated;
