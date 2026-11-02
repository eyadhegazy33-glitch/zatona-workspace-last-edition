-- ===== QUALITY CONTROL =====
begin;

create table public.qc_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  area text,
  frequency text not null default 'per_shift' check (frequency in ('per_shift','daily')),
  due_time time,                                -- for daily checklists: alert if not done by this local time
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.qc_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.qc_templates(id) on delete cascade,
  text text not null,
  critical boolean not null default false,       -- a failed critical item creates an incident
  sort int not null default 0,
  active boolean not null default true
);
create table public.qc_submissions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.qc_templates(id),
  user_id uuid not null references public.profiles(id),
  shift_session_id uuid references public.shift_sessions(id),
  submitted_at timestamptz not null default now(),
  total_items int not null,
  passed_items int not null,
  score numeric(5,2) not null,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_score int check (review_score between 1 and 5),
  review_note text
);
create index qc_submissions_template_idx on public.qc_submissions (template_id, submitted_at desc);
create table public.qc_answers (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.qc_submissions(id) on delete cascade,
  item_id uuid references public.qc_template_items(id),
  item_text text not null,                       -- snapshot: old answers never change when the checklist changes
  critical boolean not null,
  passed boolean not null,
  note text,
  photo_path text
);
create index qc_answers_submission_idx on public.qc_answers (submission_id);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id),
  rating int not null check (rating between 1 and 5),
  comment text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ===== INCIDENTS =====
create sequence public.incident_number_seq start 1;
create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  number bigint not null unique default nextval('public.incident_number_seq'),
  type text not null check (type in ('equipment','customer','cash','safety','cleaning','quality','power_internet','other')),
  severity text not null check (severity in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','assigned','in_progress','resolved','closed')),
  title text not null,
  description text,
  location text,
  reported_by uuid references public.profiles(id),
  assigned_to uuid references public.profiles(id),
  photo_paths text[] not null default '{}',
  source text not null default 'manual' check (source in ('manual','qc')),
  qc_submission_id uuid references public.qc_submissions(id),
  resolution_note text,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index incidents_status_idx on public.incidents (status, severity);
create table public.incident_events (
  id bigint generated always as identity primary key,
  incident_id uuid not null references public.incidents(id),
  user_id uuid references public.profiles(id),
  kind text not null check (kind in ('created','comment','status','assign')),
  body text,
  created_at timestamptz not null default now()
);
create index incident_events_idx on public.incident_events (incident_id, created_at);
create trigger incidents_no_delete before delete on public.incidents for each row execute function public.prevent_change();
create trigger incident_events_immutable before update or delete on public.incident_events for each row execute function public.prevent_change();

-- ===== ALERTS =====
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  severity text not null check (severity in ('low','medium','high','critical')),
  title text not null,
  detail jsonb not null default '{}',
  source_key text not null,                     -- one open alert per source_key (no duplicates)
  status text not null default 'open' check (status in ('open','acknowledged','snoozed','resolved')),
  snoozed_until timestamptz,
  acknowledged_by uuid references public.profiles(id),
  acknowledged_at timestamptz,
  assigned_to uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index alerts_open_key on public.alerts (source_key) where status in ('open','acknowledged','snoozed');
create index alerts_status_idx on public.alerts (status, severity);

-- ===== PERMISSIONS =====
insert into public.permissions (key, description) values
  ('qc.manage',        'Create and edit quality checklists'),
  ('qc.fill',          'Fill quality checklists'),
  ('qc.review',        'Review submitted checklists and see all results'),
  ('feedback.add',     'Record customer feedback'),
  ('feedback.view',    'See customer feedback'),
  ('incidents.report', 'Report and comment on incidents'),
  ('incidents.view',   'See all incidents'),
  ('incidents.manage', 'Assign, resolve, and close incidents'),
  ('alerts.view',      'See the Alert Center'),
  ('alerts.manage',    'Acknowledge, assign, and snooze alerts')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r cross join public.permissions p where r.name in ('Admin', 'owner')
on conflict do nothing;
insert into public.role_permissions (role_id, permission_key)
select r.id, x.key from public.roles r join (values
  ('Manager','qc.manage'),('Manager','qc.fill'),('Manager','qc.review'),('Manager','feedback.add'),('Manager','feedback.view'),
  ('Manager','incidents.report'),('Manager','incidents.view'),('Manager','incidents.manage'),
  ('Manager','alerts.view'),('Manager','alerts.manage'),
  ('Reception','qc.fill'),('Reception','feedback.add'),('Reception','incidents.report'),
  ('Barista','qc.fill'),('Barista','incidents.report')
) as x(role, key) on x.role = r.name
on conflict do nothing;

-- ===== RLS =====
alter table public.qc_templates enable row level security;
alter table public.qc_template_items enable row level security;
alter table public.qc_submissions enable row level security;
alter table public.qc_answers enable row level security;
alter table public.feedback enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_events enable row level security;
alter table public.alerts enable row level security;

create policy qc_templates_read on public.qc_templates for select to authenticated
  using (public.has_permission('qc.fill') or public.has_permission('qc.manage'));
create policy qc_templates_write on public.qc_templates for all to authenticated
  using (public.has_permission('qc.manage')) with check (public.has_permission('qc.manage'));
create policy qc_items_read on public.qc_template_items for select to authenticated
  using (public.has_permission('qc.fill') or public.has_permission('qc.manage'));
create policy qc_items_write on public.qc_template_items for all to authenticated
  using (public.has_permission('qc.manage')) with check (public.has_permission('qc.manage'));
create trigger qc_templates_audit after insert or update or delete on public.qc_templates for each row execute function public.audit_row();
create trigger qc_items_audit after insert or update or delete on public.qc_template_items for each row execute function public.audit_row();

create policy qc_submissions_read on public.qc_submissions for select to authenticated
  using (public.has_permission('qc.review') or user_id = auth.uid());
create policy qc_answers_read on public.qc_answers for select to authenticated
  using (exists (select 1 from public.qc_submissions s where s.id = submission_id));
create policy feedback_read on public.feedback for select to authenticated using (public.has_permission('feedback.view'));

create policy incidents_read on public.incidents for select to authenticated
  using (public.has_permission('incidents.view') or reported_by = auth.uid() or assigned_to = auth.uid());
create policy incident_events_read on public.incident_events for select to authenticated
  using (exists (select 1 from public.incidents i where i.id = incident_id));
create policy alerts_read on public.alerts for select to authenticated using (public.has_permission('alerts.view'));

-- ===== PRIVATE PHOTO STORAGE (images only, max 5 MB) =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
create policy attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments'
              and (
                ((storage.foldername(name))[1] = 'qc'
                  and (storage.foldername(name))[2] = auth.uid()::text
                  and public.has_permission('qc.fill'))
                or
                ((storage.foldername(name))[1] = 'incidents'
                  and (storage.foldername(name))[2] = auth.uid()::text
                  and public.has_permission('incidents.report'))
              ));
create policy attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments'
         and (
           ((storage.foldername(name))[1] = 'qc'
             and exists (
               select 1
               from public.qc_answers a
               join public.qc_submissions s on s.id = a.submission_id
               where a.photo_path = name
             ))
           or
           ((storage.foldername(name))[1] = 'incidents'
             and exists (
               select 1
               from public.incidents i
               where name = any(i.photo_paths)
             ))
         ));

-- ===== INCIDENT TRIGGER: timeline entry + notify managers for serious ones =====
create or replace function public.incident_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.incident_events (incident_id, user_id, kind, body) values (new.id, new.reported_by, 'created', new.title);
  if new.severity in ('high','critical') then
    insert into public.notifications (user_id, type, payload)
    select p.id, 'incident', jsonb_build_object('incident_id', new.id, 'severity', new.severity, 'title', new.title)
    from public.profiles p join public.role_permissions rp on rp.role_id = p.role_id
    where rp.permission_key = 'incidents.manage' and p.status = 'active' and p.deleted_at is null;
  end if;
  return new;
end $$;
create trigger incidents_after_insert after insert on public.incidents
  for each row execute function public.incident_after_insert();

-- ===== INCIDENT FUNCTIONS =====
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
    where x not like 'incidents/' || auth.uid()::text || '/%'
  ) then
    raise exception 'invalid photo path';
  end if;
  insert into public.incidents (type, severity, title, description, location, reported_by, photo_paths)
  values (p_type, p_severity, left(trim(p_title), 200), left(p_description, 2000), left(p_location, 200), auth.uid(), coalesce(p_photos, '{}'))
  returning * into i;
  return i;
end $$;

create or replace function public.assign_incident(p_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('incidents.manage') then raise exception 'not allowed'; end if;
  update public.incidents set assigned_to = p_user, status = case when status = 'open' then 'assigned' else status end
   where id = p_id and status <> 'closed';
  if not found then raise exception 'incident not found or closed'; end if;
  insert into public.incident_events (incident_id, user_id, kind, body) values (p_id, auth.uid(), 'assign', p_user::text);
  insert into public.notifications (user_id, type, payload)
  values (p_user, 'incident_assigned', jsonb_build_object('incident_id', p_id));
end $$;

create or replace function public.update_incident_status(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare i public.incidents;
begin
  select * into i from public.incidents where id = p_id for update;
  if not found then raise exception 'incident not found'; end if;
  if not (public.has_permission('incidents.manage')
          or (i.assigned_to = auth.uid() and p_status in ('in_progress','resolved'))) then
    raise exception 'not allowed';
  end if;
  if not ((i.status = 'open' and p_status in ('assigned','in_progress','resolved'))
       or (i.status = 'assigned' and p_status in ('in_progress','resolved'))
       or (i.status = 'in_progress' and p_status = 'resolved')
       or (i.status = 'resolved' and p_status in ('closed','in_progress'))) then
    raise exception 'invalid status change';
  end if;
  if p_status in ('resolved','closed') and length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'resolution note required';
  end if;
  update public.incidents
     set status = p_status,
         resolution_note = case when p_status in ('resolved','closed') then trim(p_note) else resolution_note end,
         resolved_at = case when p_status = 'resolved' then now() else resolved_at end,
         closed_at = case when p_status = 'closed' then now() else closed_at end
   where id = p_id;
  insert into public.incident_events (incident_id, user_id, kind, body) values (p_id, auth.uid(), 'status', p_status || ': ' || coalesce(p_note, ''));
  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (auth.uid(), 'incident.status', 'incident', p_id::text, jsonb_build_object('status', p_status));
end $$;

create or replace function public.add_incident_comment(p_id uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare i public.incidents;
begin
  select * into i from public.incidents where id = p_id;
  if not found then raise exception 'incident not found'; end if;
  if not (public.has_permission('incidents.manage') or i.reported_by = auth.uid() or i.assigned_to = auth.uid()) then
    raise exception 'not allowed';
  end if;
  if length(trim(coalesce(p_body, ''))) < 1 or length(p_body) > 1000 then raise exception 'invalid comment'; end if;
  insert into public.incident_events (incident_id, user_id, kind, body) values (p_id, auth.uid(), 'comment', trim(p_body));
end $$;

-- ===== QUALITY CONTROL FUNCTIONS =====
-- p_answers = [{ "item_id": uuid, "passed": true/false, "note": text, "photo_path": "qc/..." }, ...]  (every active item)
create or replace function public.submit_checklist(p_template uuid, p_answers jsonb)
returns public.qc_submissions language plpgsql security definer set search_path = public as $$
declare
  t public.qc_templates; s public.qc_submissions; it public.qc_template_items; a jsonb;
  v_total int; v_passed int := 0; v_ok boolean; v_shift uuid;
begin
  if not public.has_permission('qc.fill') then raise exception 'not allowed'; end if;
  select * into t from public.qc_templates where id = p_template and active;
  if not found then raise exception 'checklist not found'; end if;
  if jsonb_typeof(p_answers) <> 'array' then raise exception 'invalid answers'; end if;
  select count(*) into v_total from public.qc_template_items where template_id = p_template and active;
  if v_total = 0 then raise exception 'checklist is empty'; end if;
  if jsonb_array_length(p_answers) <> v_total then raise exception 'every item must be answered'; end if;

  select id into v_shift
  from public.shift_sessions
  where user_id = auth.uid() and closed_at is null
  order by opened_at desc
  limit 1;
  if t.frequency = 'per_shift' and v_shift is null then
    raise exception using errcode = 'P0002', message = 'an open shift is required';
  end if;
  insert into public.qc_submissions (template_id, user_id, shift_session_id, total_items, passed_items, score)
  values (p_template, auth.uid(), v_shift, v_total, 0, 0) returning * into s;

  for it in select * from public.qc_template_items where template_id = p_template and active order by sort loop
    a := null;
    select value into a from jsonb_array_elements(p_answers) where (value->>'item_id')::uuid = it.id limit 1;
    if a is null then raise exception 'every item must be answered'; end if;
    v_ok := coalesce((a->>'passed')::boolean, false);
    if v_ok then v_passed := v_passed + 1; end if;
    if (a->>'photo_path') is not null
       and (a->>'photo_path') not like 'qc/' || auth.uid()::text || '/%' then
      raise exception 'invalid photo path';
    end if;

    insert into public.qc_answers (submission_id, item_id, item_text, critical, passed, note, photo_path)
    values (s.id, it.id, it.text, it.critical, v_ok, left(a->>'note', 500), a->>'photo_path');

    if not v_ok and it.critical then
      insert into public.incidents (type, severity, title, description, reported_by, source, qc_submission_id)
      values ('quality', 'high', left('Quality check failed: ' || it.text, 200), 'Checklist: ' || t.name, auth.uid(), 'qc', s.id);
    end if;
  end loop;

  update public.qc_submissions set passed_items = v_passed, score = round(v_passed * 100.0 / v_total, 2)
   where id = s.id returning * into s;
  return s;
end $$;

create or replace function public.review_submission(p_id uuid, p_score int, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('qc.review') then raise exception 'not allowed'; end if;
  if p_score is null or p_score not between 1 and 5 then raise exception 'score must be 1 to 5'; end if;
  update public.qc_submissions set reviewed_by = auth.uid(), reviewed_at = now(), review_score = p_score, review_note = left(p_note, 500)
   where id = p_id and reviewed_at is null;
  if not found then raise exception 'submission not found or already reviewed'; end if;
end $$;

create or replace function public.add_feedback(p_customer uuid, p_rating int, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('feedback.add') then raise exception 'not allowed'; end if;
  if p_rating not between 1 and 5 then raise exception 'rating must be 1 to 5'; end if;
  insert into public.feedback (customer_id, rating, comment, created_by) values (p_customer, p_rating, left(p_comment, 500), auth.uid());
end $$;

-- ===== ALERTS =====
create or replace function public.checkin_deadline(k public.checkins)
returns timestamptz language sql stable set search_path = public as $$
  select greatest(k.timer_started_at, coalesce(k.last_qualifying_order_at, k.timer_started_at))
         + make_interval(mins => public.ops_num('ops.timer_window_minutes', 180)::int);
$$;

create or replace function public.current_alert_candidates()
returns table (type text, severity text, title text, source_key text, detail jsonb)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce((select value #>> '{}' from public.settings where key = 'ops.timezone'), 'Africa/Cairo') as tz,
           public.ops_num('ops.timer_grace_minutes', 0)::int as grace,
           coalesce(
             (
               select (value #>> '{}')::numeric
               from public.settings
               where key = 'ops.cash_diff_alert'
                 and jsonb_typeof(value) = 'number'
             ),
             public.ops_num('ops.cash_difference_alert_amount', 50)
           ) as cash_diff
  )
  select 'overdue'::text, 'high'::text, 'Customer overdue: ' || c.first_name || ' ' || c.last_name,
         'overdue:' || k.id::text, jsonb_build_object('checkin_id', k.id, 'customer_id', c.id)
  from public.checkins k join public.customers c on c.id = k.customer_id, cfg
  where k.checked_out_at is null and now() >= public.checkin_deadline(k) + make_interval(mins => cfg.grace)
  union all
  select 'low_stock', 'medium', 'Low stock: ' || i.name, 'lowstock:' || i.id::text,
         jsonb_build_object('item_id', i.id, 'qty', i.qty, 'min_qty', i.min_qty)
  from public.inventory_items i where i.active and i.qty <= i.min_qty
  union all
  select 'shift_open', 'medium', 'A shift is still open after 14 hours', 'shift:' || s.id::text,
         jsonb_build_object('session_id', s.id)
  from public.shift_sessions s where s.closed_at is null and s.opened_at < now() - interval '14 hours'
  union all
  select 'cash_difference', 'high', 'Cash difference on a closed shift', 'cash:' || s.id::text,
         jsonb_build_object('session_id', s.id, 'difference', s.cash_counted - s.cash_expected)
  from public.shift_sessions s, cfg
  where s.closed_at > now() - interval '24 hours' and s.cash_counted is not null and s.cash_expected is not null
    and abs(s.cash_counted - s.cash_expected) >= cfg.cash_diff
  union all
  select 'scan_failures', 'high', 'Many failed scans in the last 10 minutes',
         'scanfail:' || to_char(date_trunc('hour', now()), 'YYYYMMDDHH24'), jsonb_build_object('count', x.n)
  from (select count(*) as n from public.scan_logs where created_at > now() - interval '10 minutes' and result <> 'ok') x
  where x.n >= 5
  union all
  select 'critical_incident', 'critical', 'Critical incident open: ' || i.title, 'incident:' || i.id::text,
         jsonb_build_object('incident_id', i.id)
  from public.incidents i where i.severity = 'critical' and i.status in ('open','assigned','in_progress')
  union all
  select 'missed_checklist', 'medium', 'Checklist not done: ' || t.name,
         'qc:' || t.id::text || ':' || to_char(now() at time zone cfg.tz, 'YYYYMMDD'),
         jsonb_build_object('template_id', t.id)
  from public.qc_templates t, cfg
  where t.active and t.frequency = 'daily' and t.due_time is not null
    and (now() at time zone cfg.tz)::time >= t.due_time
    and not exists (select 1 from public.qc_submissions q where q.template_id = t.id
                    and (q.submitted_at at time zone cfg.tz)::date = (now() at time zone cfg.tz)::date);
$$;

create or replace function public.generate_alerts()
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.alerts (type, severity, title, source_key, detail)
  select c.type, c.severity, c.title, c.source_key, c.detail from public.current_alert_candidates() c
  on conflict (source_key) where status in ('open','acknowledged','snoozed') do nothing;

  -- alerts whose problem is gone resolve themselves
  update public.alerts set status = 'resolved', resolved_at = now()
   where status in ('open','acknowledged','snoozed')
     and source_key not in (select source_key from public.current_alert_candidates());

  update public.alerts set status = 'open', snoozed_until = null
   where status = 'snoozed' and snoozed_until <= now();
end $$;

create or replace function public.alert_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type in ('cash_difference','scan_failures') then
    insert into public.notifications (user_id, type, payload)
    select p.id, 'alert', jsonb_build_object('alert_id', new.id, 'title', new.title, 'severity', new.severity)
    from public.profiles p join public.role_permissions rp on rp.role_id = p.role_id
    where rp.permission_key = 'alerts.manage' and p.status = 'active' and p.deleted_at is null;
  end if;
  return new;
end $$;
create trigger alerts_after_insert after insert on public.alerts
  for each row execute function public.alert_after_insert();

create or replace function public.acknowledge_alert(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('alerts.manage') then raise exception 'not allowed'; end if;
  update public.alerts set status = 'acknowledged', acknowledged_by = auth.uid(), acknowledged_at = now()
   where id = p_id and status in ('open','snoozed');
  if not found then raise exception 'alert not found or already handled'; end if;
end $$;

create or replace function public.assign_alert(p_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('alerts.manage') then raise exception 'not allowed'; end if;
  update public.alerts set assigned_to = p_user where id = p_id and status <> 'resolved';
  if not found then raise exception 'alert not found or resolved'; end if;
end $$;

create or replace function public.snooze_alert(p_id uuid, p_minutes int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('alerts.manage') then raise exception 'not allowed'; end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 1440 then raise exception 'invalid snooze time'; end if;
  update public.alerts set status = 'snoozed', snoozed_until = now() + make_interval(mins => p_minutes)
   where id = p_id and status in ('open','acknowledged');
  if not found then raise exception 'alert not found or already handled'; end if;
end $$;

-- ===== GRANTS =====
revoke execute on function public.report_incident(text, text, text, text, text, text[]) from public, anon;
revoke execute on function public.assign_incident(uuid, uuid) from public, anon;
revoke execute on function public.update_incident_status(uuid, text, text) from public, anon;
revoke execute on function public.add_incident_comment(uuid, text) from public, anon;
revoke execute on function public.submit_checklist(uuid, jsonb) from public, anon;
revoke execute on function public.review_submission(uuid, int, text) from public, anon;
revoke execute on function public.add_feedback(uuid, int, text) from public, anon;
revoke execute on function public.acknowledge_alert(uuid) from public, anon;
revoke execute on function public.assign_alert(uuid, uuid) from public, anon;
revoke execute on function public.snooze_alert(uuid, int) from public, anon;
revoke execute on function public.checkin_deadline(public.checkins) from public, anon;
revoke execute on function public.current_alert_candidates() from public, anon, authenticated;
revoke execute on function public.generate_alerts() from public, anon, authenticated;
grant execute on function public.report_incident(text, text, text, text, text, text[]) to authenticated;
grant execute on function public.assign_incident(uuid, uuid) to authenticated;
grant execute on function public.update_incident_status(uuid, text, text) to authenticated;
grant execute on function public.add_incident_comment(uuid, text) to authenticated;
grant execute on function public.submit_checklist(uuid, jsonb) to authenticated;
grant execute on function public.review_submission(uuid, int, text) to authenticated;
grant execute on function public.add_feedback(uuid, int, text) to authenticated;
grant execute on function public.acknowledge_alert(uuid) to authenticated;
grant execute on function public.assign_alert(uuid, uuid) to authenticated;
grant execute on function public.snooze_alert(uuid, int) to authenticated;

alter publication supabase_realtime add table public.alerts;
alter publication supabase_realtime add table public.incidents;

-- generate alerts every minute
select cron.unschedule(jobid) from cron.job where jobname = 'zatona-alerts';
select cron.schedule('zatona-alerts', '* * * * *', $$select public.generate_alerts()$$);

commit;