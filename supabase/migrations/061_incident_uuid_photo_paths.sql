begin;

drop policy attachments_insert on storage.objects;
create policy attachments_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (
      (
        name ~ '^qc/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
        and public.has_permission('qc.fill')
      )
      or (
        name ~ '^incidents/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
        and public.has_permission('incidents.report')
      )
    )
  );

create or replace function public.report_incident(
  p_type text, p_severity text, p_title text, p_description text default null,
  p_location text default null, p_photos text[] default '{}')
returns public.incidents language plpgsql security definer set search_path = public as $$
declare i public.incidents;
begin
  if not public.has_permission('incidents.report') then raise exception 'not allowed'; end if;
  if nullif(trim(p_title), '') is null then raise exception 'title required'; end if;
  if cardinality(coalesce(p_photos, '{}')) > 5 then raise exception 'too many photos'; end if;
  if exists (
    select 1 from unnest(coalesce(p_photos, '{}')) x
    where x !~ '^incidents/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
  ) then
    raise exception 'invalid photo path';
  end if;
  insert into public.incidents (type, severity, title, description, location, reported_by, photo_paths)
  values (p_type, p_severity, left(trim(p_title), 200), left(p_description, 2000), left(p_location, 200), auth.uid(), coalesce(p_photos, '{}'))
  returning * into i;
  return i;
end $$;
revoke execute on function public.report_incident(text, text, text, text, text, text[]) from public, anon;
grant execute on function public.report_incident(text, text, text, text, text, text[]) to authenticated;

create or replace function public.assign_incident(p_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('incidents.manage') then raise exception 'not allowed'; end if;
  if not exists (
    select 1 from public.profiles
    where id = p_user and status = 'active' and deleted_at is null
  ) then
    raise exception 'active staff member required';
  end if;
  update public.incidents
     set assigned_to = p_user,
         status = case when status = 'open' then 'assigned' else status end
   where id = p_id and status <> 'closed';
  if not found then raise exception 'incident not found or closed'; end if;
  insert into public.incident_events (incident_id, user_id, kind, body)
  values (p_id, auth.uid(), 'assign', p_user::text);
  insert into public.notifications (user_id, type, payload)
  values (p_user, 'incident_assigned', jsonb_build_object('incident_id', p_id));
end $$;
revoke execute on function public.assign_incident(uuid, uuid) from public, anon;
grant execute on function public.assign_incident(uuid, uuid) to authenticated;

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
   and assigned.id = e.body::uuid
  where e.incident_id = p_id
  order by e.created_at, e.id;
end $$;
revoke execute on function public.get_incident_timeline(uuid) from public, anon;
grant execute on function public.get_incident_timeline(uuid) to authenticated;

create or replace function public.get_incident_staff()
returns table (user_id uuid, first_name text, last_name text, role_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('incidents.manage') then raise exception 'not allowed'; end if;
  return query
  select p.id, p.first_name, p.last_name, r.name
  from public.profiles p
  left join public.roles r on r.id = p.role_id
  where p.status = 'active' and p.deleted_at is null
  order by p.first_name, p.last_name;
end $$;
revoke execute on function public.get_incident_staff() from public, anon;
grant execute on function public.get_incident_staff() to authenticated;

commit;
