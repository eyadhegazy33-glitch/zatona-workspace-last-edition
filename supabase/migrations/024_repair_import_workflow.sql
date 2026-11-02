create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  filename text,
  total integer not null default 0,
  created integer not null default 0,
  updated integer not null default 0,
  skipped integer not null default 0,
  failed integer not null default 0,
  rolled_back_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.imports
  add column if not exists user_id uuid references public.profiles(id),
  add column if not exists created_by uuid references public.profiles(id),
  add column if not exists filename text,
  add column if not exists total integer not null default 0,
  add column if not exists created integer not null default 0,
  add column if not exists updated integer not null default 0,
  add column if not exists skipped integer not null default 0,
  add column if not exists failed integer not null default 0,
  add column if not exists rolled_back_at timestamptz,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.import_errors (
  id bigint generated always as identity primary key,
  import_id uuid not null references public.imports(id) on delete cascade,
  row_number integer not null,
  reason text not null
);

alter table public.customers
  add column if not exists import_id uuid
  references public.imports(id) on delete set null;

alter table public.imports enable row level security;
alter table public.import_errors enable row level security;

drop policy if exists imports_read on public.imports;
drop policy if exists imports_read_for_cards on public.imports;
create policy imports_read
  on public.imports
  for select
  to authenticated
  using (
    public.has_permission('customers.import')
    or public.has_permission('customers.cards')
  );

drop policy if exists import_errors_read on public.import_errors;
drop policy if exists import_errors_read_for_cards on public.import_errors;
create policy import_errors_read
  on public.import_errors
  for select
  to authenticated
  using (public.has_permission('customers.import'));

revoke all on public.imports, public.import_errors
  from public, anon, authenticated;
grant select on public.imports, public.import_errors to authenticated;

create or replace function public.rollback_import(p_import uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rolled_back_at timestamptz;
  v_hidden integer;
begin
  if not (
    public.has_permission('customers.import')
    and public.has_permission('customers.delete')
  ) then
    raise exception 'not allowed';
  end if;

  select rolled_back_at
  into v_rolled_back_at
  from public.imports
  where id = p_import
  for update;

  if not found then
    raise exception 'import not found';
  end if;
  if v_rolled_back_at is not null then
    raise exception 'already rolled back';
  end if;

  if exists (
    select 1
    from public.customers c
    join public.checkins k on k.customer_id = c.id
    where c.import_id = p_import
  ) then
    raise exception 'some imported customers already have visits; cannot roll back';
  end if;

  update public.customers
  set deleted_at = now()
  where import_id = p_import
    and deleted_at is null;
  get diagnostics v_hidden = row_count;

  update public.imports
  set rolled_back_at = now()
  where id = p_import;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(),
    'customers.import_rollback',
    'import',
    p_import::text,
    jsonb_build_object('hidden', v_hidden)
  );

  return v_hidden;
end;
$$;

revoke execute on function public.rollback_import(uuid) from public, anon;
grant execute on function public.rollback_import(uuid) to authenticated;
