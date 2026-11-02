create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;

create policy settings_public_read
  on public.settings
  for select
  to anon, authenticated
  using (key in ('workspace_name', 'logo_url', 'primary_color', 'secondary_color'));

revoke insert, update, delete on public.settings from public, anon, authenticated;
grant select on public.settings to anon, authenticated;

insert into public.settings (key, value)
values
  ('workspace_name', '"elzatona"'::jsonb),
  ('logo_url', 'null'::jsonb),
  ('primary_color', '"#315c45"'::jsonb),
  ('secondary_color', '"#202721"'::jsonb)
on conflict (key) do nothing;

create or replace function public.update_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_value jsonb;
  v_new_value jsonb;
begin
  if not public.has_permission('settings.manage') then
    raise exception 'not allowed';
  end if;

  if p_key is null
     or p_key not in ('workspace_name', 'logo_url', 'primary_color', 'secondary_color') then
    raise exception 'setting key is not supported';
  end if;

  if p_value is null and p_key <> 'logo_url' then
    raise exception 'setting value is required';
  end if;

  v_new_value := coalesce(p_value, 'null'::jsonb);

  if p_key = 'workspace_name'
     and (jsonb_typeof(v_new_value) <> 'string'
       or length(trim(v_new_value #>> '{}')) not between 1 and 80) then
    raise exception 'invalid workspace name';
  end if;

  if p_key = 'logo_url'
     and jsonb_typeof(v_new_value) not in ('string', 'null') then
    raise exception 'invalid logo URL';
  end if;

  if p_key in ('primary_color', 'secondary_color')
     and (jsonb_typeof(v_new_value) <> 'string'
       or v_new_value #>> '{}' !~ '^#[0-9A-Fa-f]{6}$') then
    raise exception 'invalid color';
  end if;

  select value into v_old_value
  from public.settings
  where key = p_key
  for update;

  insert into public.settings (key, value, updated_by, updated_at)
  values (p_key, v_new_value, auth.uid(), now())
  on conflict (key) do update
    set value = excluded.value,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  insert into public.audit_logs (
    actor_id, action, entity, entity_id, old_value, new_value
  )
  values (
    auth.uid(),
    'setting.update',
    'setting',
    p_key,
    jsonb_build_object('value', v_old_value),
    jsonb_build_object('value', v_new_value)
  );
end;
$$;

revoke all on function public.update_setting(text, jsonb) from public, anon;
grant execute on function public.update_setting(text, jsonb) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'branding',
  'branding',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy branding_images_public_read
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'branding');

create policy branding_images_manage_insert
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'branding' and public.has_permission('settings.manage'));

create policy branding_images_manage_update
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'branding' and public.has_permission('settings.manage'))
  with check (bucket_id = 'branding' and public.has_permission('settings.manage'));

create policy branding_images_manage_delete
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'branding' and public.has_permission('settings.manage'));
