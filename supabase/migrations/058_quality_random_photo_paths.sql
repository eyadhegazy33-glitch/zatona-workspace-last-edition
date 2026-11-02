begin;

drop policy qc_templates_read on public.qc_templates;
create policy qc_templates_read on public.qc_templates for select to authenticated
  using (
    public.has_permission('qc.fill')
    or public.has_permission('qc.manage')
    or public.has_permission('qc.review')
  );
drop policy qc_items_read on public.qc_template_items;
create policy qc_items_read on public.qc_template_items for select to authenticated
  using (
    public.has_permission('qc.fill')
    or public.has_permission('qc.manage')
    or public.has_permission('qc.review')
  );

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
        name like 'incidents/' || auth.uid()::text || '/%'
        and public.has_permission('incidents.report')
      )
    )
  );

create or replace function public.submit_checklist(p_template uuid, p_answers jsonb)
returns public.qc_submissions language plpgsql security definer set search_path = public as $$
declare
  t public.qc_templates; s public.qc_submissions; it public.qc_template_items; a jsonb;
  v_total int; v_passed int := 0; v_ok boolean; v_shift uuid;
  v_timezone text;
begin
  if not public.has_permission('qc.fill') then raise exception 'not allowed'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_template::text, 0));
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
  if t.frequency = 'per_shift' and exists (
    select 1 from public.qc_submissions
    where template_id = p_template and user_id = auth.uid() and shift_session_id = v_shift
  ) then
    raise exception 'checklist already submitted';
  end if;
  if t.frequency = 'daily' then
    select coalesce(value #>> '{}', 'Africa/Cairo') into v_timezone
    from public.settings
    where key = 'ops.timezone';
    v_timezone := coalesce(v_timezone, 'Africa/Cairo');
    if exists (
      select 1 from public.qc_submissions
      where template_id = p_template
        and user_id = auth.uid()
        and (submitted_at at time zone v_timezone)::date = (now() at time zone v_timezone)::date
    ) then
      raise exception 'checklist already submitted';
    end if;
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
       and (a->>'photo_path') !~ '^qc/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$' then
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

create or replace function public.get_quality_feedback_summary()
returns table (average_rating numeric, feedback_count bigint, latest_comments jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('feedback.view') then raise exception 'not allowed'; end if;
  return query
  select coalesce(avg(f.rating), 0)::numeric,
         count(*)::bigint,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'rating', recent.rating,
             'comment', recent.comment,
             'created_at', recent.created_at
           ) order by recent.created_at desc)
           from (
             select rating, comment, created_at
             from public.feedback
             order by created_at desc
             limit 10
           ) recent
         ), '[]'::jsonb)
  from public.feedback f;
end $$;
revoke execute on function public.get_quality_feedback_summary() from public, anon;
grant execute on function public.get_quality_feedback_summary() to authenticated;

commit;
