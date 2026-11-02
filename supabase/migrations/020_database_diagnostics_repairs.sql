-- Repair objects identified by the live database diagnostics.
create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.import_errors (
  id bigint generated always as identity primary key,
  import_id uuid not null references public.imports(id) on delete cascade,
  row_number integer not null,
  reason text not null
);

alter table public.imports enable row level security;
alter table public.import_errors enable row level security;

drop policy if exists imports_read_for_cards on public.imports;
create policy imports_read_for_cards on public.imports
  for select to authenticated
  using (public.has_permission('customers.cards'));

drop policy if exists import_errors_read_for_cards on public.import_errors;
create policy import_errors_read_for_cards on public.import_errors
  for select to authenticated
  using (public.has_permission('customers.import'));

alter table public.customers
  add column if not exists import_id uuid references public.imports(id) on delete set null;

create index if not exists customers_import_id_idx
  on public.customers(import_id) where deleted_at is null;

revoke all on public.imports from public, anon, authenticated;
revoke all on public.import_errors from public, anon, authenticated;
grant select on public.imports to authenticated;
grant select on public.import_errors to authenticated;

revoke all on public.customers from authenticated;
grant select (
  id, code, first_name, last_name, full_name, birth_date, student_type_id,
  phone, expiry_date, notes, status, created_at, updated_at, deleted_at, import_id
) on public.customers to authenticated;

create or replace function public.get_customer_qr_token(p_customer uuid)
returns text language plpgsql security definer set search_path = public
as $$
declare v_token text;
begin
  if not public.has_permission('customers.cards') then
    raise exception 'not allowed';
  end if;
  select c.qr_token into v_token from public.customers c
  where c.id = p_customer and c.deleted_at is null;
  if v_token is null then raise exception 'customer not found'; end if;
  return v_token;
end;
$$;
revoke all on function public.get_customer_qr_token(uuid) from public, anon;
grant execute on function public.get_customer_qr_token(uuid) to authenticated;

create or replace function public.log_card_print(p_count integer)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_permission('customers.cards') then
    raise exception 'not allowed';
  end if;
  if p_count is null or p_count < 1 or p_count > 500 then
    raise exception 'invalid card count';
  end if;
  insert into public.audit_logs (actor_id, action, entity, new_value)
  values (auth.uid(), 'cards.print', 'customer_cards', jsonb_build_object('count', p_count));
end;
$$;
revoke all on function public.log_card_print(integer) from public, anon;
grant execute on function public.log_card_print(integer) to authenticated;
