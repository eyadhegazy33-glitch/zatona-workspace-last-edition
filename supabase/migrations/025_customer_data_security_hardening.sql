begin;

revoke insert, update, delete, truncate, references, trigger
  on table public.customers, public.checkins, public.imports, public.scan_logs
  from public, anon, authenticated;

create or replace function public.scan_customer(p_input text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  c public.customers;
  v_input text := pg_catalog.btrim(coalesce(p_input, ''));
  v_result text;
  v_checkin public.checkins;
begin
  if not coalesce(public.has_permission('scanner.use'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  if pg_catalog.length(v_input) > 512 then
    v_input := '';
  end if;

  select *
    into c
  from public.customers
  where deleted_at is null
    and (qr_token = v_input or pg_catalog.upper(code) = pg_catalog.upper(v_input))
  limit 1;

  if not found then
    insert into public.scan_logs (user_id, result)
    values (auth.uid(), 'unknown');
    return pg_catalog.jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  v_result := case
    when c.status = 'blocked' then 'blocked'
    when c.status = 'expired'
      or (c.expiry_date is not null and c.expiry_date < current_date)
      then 'expired'
    else 'ok'
  end;

  insert into public.scan_logs (user_id, customer_id, result)
  values (auth.uid(), c.id, v_result);

  select *
    into v_checkin
  from public.checkins
  where customer_id = c.id
    and checked_out_at is null
  order by checked_in_at desc
  limit 1;

  return pg_catalog.jsonb_build_object(
    'ok', v_result = 'ok',
    'reason', v_result,
    'customer', pg_catalog.jsonb_build_object(
      'id', c.id,
      'code', c.code,
      'first_name', c.first_name,
      'last_name', c.last_name,
      'birth_date', c.birth_date
    ),
    'checkin', case
      when v_checkin.id is not null then pg_catalog.to_jsonb(v_checkin)
      else null
    end
  );
end;
$$;

create or replace function public.reissue_qr_token(p_customer uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_qr_token text;
begin
  if not coalesce(public.has_permission('customers.edit'), false)
     or not coalesce(public.has_permission('customers.view'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  update public.customers
  set qr_token = pg_catalog.encode(extensions.gen_random_bytes(32), 'hex'),
      updated_at = pg_catalog.now()
  where id = p_customer
    and deleted_at is null
  returning qr_token into v_qr_token;

  if not found then
    raise exception using errcode = 'P0002', message = 'customer not found';
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id)
  values (auth.uid(), 'customer.qr.reissue', 'customer', p_customer::text);

  return v_qr_token;
end;
$$;

create or replace function public.get_customer_qr_token(p_customer uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_token text;
begin
  if not coalesce(public.has_permission('customers.view'), false)
     or not coalesce(public.has_permission('customers.cards'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select c.qr_token
    into v_token
  from public.customers c
  where c.id = p_customer
    and c.deleted_at is null;

  if v_token is null then
    raise exception using errcode = 'P0002', message = 'customer not found';
  end if;

  return v_token;
end;
$$;

create or replace function public.import_customers(
  p_rows jsonb,
  p_filename text,
  p_update_existing boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  r jsonb;
  i integer := 0;
  v_row_count integer;
  v_import uuid;
  c_created integer := 0;
  c_updated integer := 0;
  c_skipped integer := 0;
  c_failed integer := 0;
  v_first text;
  v_last text;
  v_birth date;
  v_type uuid;
  v_phone text;
  v_existing uuid;
begin
  if not coalesce(public.has_permission('customers.import'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  if p_rows is null or pg_catalog.jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'invalid import payload';
  end if;

  v_row_count := pg_catalog.jsonb_array_length(p_rows);
  if v_row_count > 5000 then
    raise exception using errcode = '22023', message = 'import exceeds row limit';
  end if;

  insert into public.imports (user_id, filename, total)
  values (auth.uid(), pg_catalog.left(coalesce(p_filename, ''), 200), v_row_count)
  returning id into v_import;

  for r in select value from pg_catalog.jsonb_array_elements(p_rows)
  loop
    i := i + 1;
    begin
      if pg_catalog.jsonb_typeof(r) is distinct from 'object' then
        raise exception 'invalid row';
      end if;

      v_first := nullif(pg_catalog.btrim(r->>'first_name'), '');
      v_last := nullif(pg_catalog.btrim(r->>'last_name'), '');
      v_birth := nullif(r->>'birth_date', '')::date;
      v_phone := nullif(pg_catalog.btrim(r->>'phone'), '');

      select st.id
        into v_type
      from public.student_types st
      where pg_catalog.lower(pg_catalog.btrim(st.name_en))
        = pg_catalog.lower(pg_catalog.btrim(r->>'student_type'))
        and st.is_active
      limit 1;

      if v_first is null or v_last is null or v_birth is null or v_type is null then
        raise exception 'invalid row';
      end if;
      if v_birth > current_date or v_birth < date '1900-01-01' then
        raise exception 'invalid row';
      end if;

      select c.id
        into v_existing
      from public.customers c
      where c.deleted_at is null
        and (
          (v_phone is not null and c.phone = v_phone)
          or (
            pg_catalog.lower(c.first_name) = pg_catalog.lower(v_first)
            and pg_catalog.lower(c.last_name) = pg_catalog.lower(v_last)
            and c.birth_date = v_birth
          )
        )
      limit 1;

      if v_existing is null then
        insert into public.customers (
          first_name, last_name, birth_date, student_type_id, phone, import_id
        )
        values (v_first, v_last, v_birth, v_type, v_phone, v_import);
        c_created := c_created + 1;
      elsif coalesce(p_update_existing, false) then
        update public.customers
        set first_name = v_first,
            last_name = v_last,
            birth_date = v_birth,
            student_type_id = v_type,
            phone = coalesce(v_phone, phone),
            updated_at = pg_catalog.now()
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
        'Invalid row data. Check required fields, date, and student type.'
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
    pg_catalog.jsonb_build_object(
      'created', c_created,
      'updated', c_updated,
      'skipped', c_skipped,
      'failed', c_failed
    )
  );

  return pg_catalog.jsonb_build_object(
    'import_id', v_import,
    'created', c_created,
    'updated', c_updated,
    'skipped', c_skipped,
    'failed', c_failed
  );
end;
$$;

revoke all on function public.scan_customer(text) from public, anon;
revoke all on function public.check_in(uuid, uuid) from public, anon;
revoke all on function public.check_out(bigint) from public, anon;
drop function if exists public.check_out(uuid);
revoke all on function public.assign_customer_resource(bigint, uuid) from public, anon;
revoke all on function public.get_resource_occupancy() from public, anon;
revoke all on function public.create_customer(text, text, date, uuid, text, date, text)
  from public, anon;
revoke all on function public.update_customer(uuid, text, text, date, uuid, text, date, text)
  from public, anon;
revoke all on function public.set_customer_status(uuid, public.customer_status)
  from public, anon;
revoke all on function public.soft_delete_customer(uuid) from public, anon;
revoke all on function public.reissue_qr_token(uuid) from public, anon;
revoke all on function public.get_customer_qr_token(uuid) from public, anon;
revoke all on function public.import_customers(jsonb, text, boolean) from public, anon;
revoke all on function public.rollback_import(uuid) from public, anon;
revoke all on function public.log_card_print(integer) from public, anon;
revoke all on function public.audit_row() from public, anon, authenticated;
revoke select (qr_token) on public.customers from public, anon, authenticated;

grant execute on function public.scan_customer(text) to authenticated;
grant execute on function public.check_in(uuid, uuid) to authenticated;
grant execute on function public.check_out(bigint) to authenticated;
grant execute on function public.assign_customer_resource(bigint, uuid) to authenticated;
grant execute on function public.get_resource_occupancy() to authenticated;
grant execute on function public.create_customer(text, text, date, uuid, text, date, text)
  to authenticated;
grant execute on function public.update_customer(uuid, text, text, date, uuid, text, date, text)
  to authenticated;
grant execute on function public.set_customer_status(uuid, public.customer_status)
  to authenticated;
grant execute on function public.soft_delete_customer(uuid) to authenticated;
grant execute on function public.reissue_qr_token(uuid) to authenticated;
grant execute on function public.get_customer_qr_token(uuid) to authenticated;
grant execute on function public.import_customers(jsonb, text, boolean) to authenticated;
grant execute on function public.rollback_import(uuid) to authenticated;
grant execute on function public.log_card_print(integer) to authenticated;

drop function if exists public.scan_public_card(text);

commit;
