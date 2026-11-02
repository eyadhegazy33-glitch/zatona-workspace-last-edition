-- Bring QR token reads and customer imports in line with the current customer schema.

grant select (qr_token) on public.customers to authenticated;

create or replace function public.import_customers(
  p_rows jsonb,
  p_filename text,
  p_update_existing boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  i int := 0;
  v_import uuid;
  c_created int := 0;
  c_updated int := 0;
  c_skipped int := 0;
  c_failed int := 0;
  v_first text;
  v_last text;
  v_birth date;
  v_type uuid;
  v_phone text;
  v_existing uuid;
begin
  if not public.has_permission('customers.import') then
    raise exception 'not allowed';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'too many rows (max 5000)';
  end if;

  insert into public.imports (user_id, filename, total)
  values (auth.uid(), left(coalesce(p_filename, ''), 200), jsonb_array_length(p_rows))
  returning id into v_import;

  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      v_first := nullif(btrim(r->>'first_name'), '');
      v_last := nullif(btrim(r->>'last_name'), '');
      v_birth := nullif(r->>'birth_date', '')::date;
      v_phone := nullif(btrim(r->>'phone'), '');

      select id into v_type
      from public.student_types
      where lower(btrim(name_en)) = lower(btrim(r->>'student_type'))
        and is_active
      limit 1;

      if v_first is null or v_last is null or v_birth is null or v_type is null then
        raise exception 'missing or invalid required field (name, birth date, student type)';
      end if;
      if v_birth > current_date or v_birth < date '1900-01-01' then
        raise exception 'invalid birth date';
      end if;

      select id into v_existing
      from public.customers
      where deleted_at is null
        and (
          (v_phone is not null and phone = v_phone)
          or (
            lower(first_name) = lower(v_first)
            and lower(last_name) = lower(v_last)
            and birth_date = v_birth
          )
        )
      limit 1;

      if v_existing is null then
        insert into public.customers (
          first_name, last_name, birth_date, student_type_id, phone, import_id
        )
        values (
          v_first, v_last, v_birth, v_type, v_phone, v_import
        );
        c_created := c_created + 1;
      elsif p_update_existing then
        update public.customers
        set first_name = v_first,
            last_name = v_last,
            birth_date = v_birth,
            student_type_id = v_type,
            phone = coalesce(v_phone, phone),
            updated_at = now()
        where id = v_existing;
        c_updated := c_updated + 1;
      else
        c_skipped := c_skipped + 1;
      end if;
    exception when others then
      c_failed := c_failed + 1;
      insert into public.import_errors (import_id, row_number, reason)
      values (
        v_import,
        i,
        case
          when sqlstate in ('22007', '22008') then 'invalid date'
          else sqlerrm
        end
      );
    end;
  end loop;

  update public.imports
  set created = c_created,
      updated = c_updated,
      skipped = c_skipped,
      failed = c_failed
  where id = v_import;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(),
    'customers.import',
    'import',
    v_import::text,
    jsonb_build_object(
      'created', c_created,
      'updated', c_updated,
      'skipped', c_skipped,
      'failed', c_failed
    )
  );

  return jsonb_build_object(
    'import_id', v_import,
    'created', c_created,
    'updated', c_updated,
    'skipped', c_skipped,
    'failed', c_failed
  );
end;
$$;

revoke execute on function public.import_customers(jsonb, text, boolean)
  from public, anon;
grant execute on function public.import_customers(jsonb, text, boolean)
  to authenticated;
