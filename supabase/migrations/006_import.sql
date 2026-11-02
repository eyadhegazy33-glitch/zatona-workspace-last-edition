create table public.imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  filename text,
  total int not null default 0,
  created int not null default 0,
  updated int not null default 0,
  skipped int not null default 0,
  failed int not null default 0,
  rolled_back_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.import_errors (
  id bigint generated always as identity primary key,
  import_id uuid not null references public.imports(id) on delete cascade,
  row_number int not null,
  reason text not null
);

alter table public.customers add column import_id uuid references public.imports(id);

alter table public.imports enable row level security;
alter table public.import_errors enable row level security;
create policy imports_read on public.imports for select to authenticated using (public.has_permission('customers.import'));
create policy import_errors_read on public.import_errors for select to authenticated using (public.has_permission('customers.import'));

-- p_rows = [{first_name,last_name,birth_date('YYYY-MM-DD'),student_type,phone}, ...]
create or replace function public.import_customers(p_rows jsonb, p_filename text, p_update_existing boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; i int := 0; v_import uuid;
  c_created int := 0; c_updated int := 0; c_skipped int := 0; c_failed int := 0;
  v_first text; v_last text; v_birth date; v_type uuid; v_phone text; v_existing uuid;
begin
  if not public.has_permission('customers.import') then raise exception 'not allowed'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be an array'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'too many rows (max 5000)'; end if;

  insert into public.imports (user_id, filename, total)
  values (auth.uid(), left(coalesce(p_filename,''), 200), jsonb_array_length(p_rows))
  returning id into v_import;

  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      v_first := nullif(trim(r->>'first_name'), '');
      v_last  := nullif(trim(r->>'last_name'), '');
      v_birth := (r->>'birth_date')::date;
      v_phone := nullif(trim(r->>'phone'), '');
      select id into v_type from public.student_types
       where lower(name) = lower(trim(r->>'student_type')) and active;

      if v_first is null or v_last is null or v_birth is null or v_type is null then
        raise exception 'missing or invalid required field (name, birth date, student type)';
      end if;
      if v_birth > current_date or v_birth < date '1900-01-01' then raise exception 'invalid birth date'; end if;

      select id into v_existing from public.customers
       where deleted_at is null
         and ((v_phone is not null and phone = v_phone)
              or (lower(first_name) = lower(v_first) and lower(last_name) = lower(v_last) and birth_date = v_birth))
       limit 1;

      if v_existing is null then
        insert into public.customers (first_name, last_name, birth_date, student_type_id, phone, created_by, import_id)
        values (v_first, v_last, v_birth, v_type, v_phone, auth.uid(), v_import);
        c_created := c_created + 1;
      elsif p_update_existing then
        update public.customers
           set first_name = v_first, last_name = v_last, birth_date = v_birth,
               student_type_id = v_type, phone = coalesce(v_phone, phone), updated_at = now()
         where id = v_existing;
        c_updated := c_updated + 1;
      else
        c_skipped := c_skipped + 1;
      end if;
    exception when others then
      c_failed := c_failed + 1;
      insert into public.import_errors (import_id, row_number, reason)
      values (v_import, i, case when sqlstate in ('22007','22008') then 'invalid date' else sqlerrm end);
    end;
  end loop;

  update public.imports set created = c_created, updated = c_updated, skipped = c_skipped, failed = c_failed
   where id = v_import;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (auth.uid(), 'customers.import', 'import', v_import::text,
          jsonb_build_object('created', c_created, 'updated', c_updated, 'skipped', c_skipped, 'failed', c_failed));

  return jsonb_build_object('import_id', v_import, 'created', c_created, 'updated', c_updated,
                            'skipped', c_skipped, 'failed', c_failed);
end $$;

-- undo an import: hides the customers that import created
create or replace function public.rollback_import(p_import uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (public.has_permission('customers.import') and public.has_permission('customers.delete')) then
    raise exception 'not allowed';
  end if;
  if exists (select 1 from public.imports where id = p_import and rolled_back_at is not null) then
    raise exception 'already rolled back';
  end if;
  if exists (select 1 from public.customers c join public.checkins k on k.customer_id = c.id
             where c.import_id = p_import) then
    raise exception 'some imported customers already have visits; cannot roll back';
  end if;
  update public.customers set deleted_at = now() where import_id = p_import and deleted_at is null;
  get diagnostics n = row_count;
  update public.imports set rolled_back_at = now() where id = p_import;
  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (auth.uid(), 'customers.import_rollback', 'import', p_import::text, jsonb_build_object('hidden', n));
  return n;
end $$;

revoke execute on function public.import_customers(jsonb, text, boolean) from public, anon;
revoke execute on function public.rollback_import(uuid) from public, anon;
grant execute on function public.import_customers(jsonb, text, boolean) to authenticated;
grant execute on function public.rollback_import(uuid) to authenticated;
