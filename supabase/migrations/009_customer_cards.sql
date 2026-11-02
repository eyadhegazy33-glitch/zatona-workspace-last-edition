create table public.imports (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.imports enable row level security;
create policy imports_read_for_cards
  on public.imports
  for select
  to authenticated
  using (public.has_permission('customers.cards'));

revoke all on public.imports from public, anon, authenticated;
grant select (id, created_at) on public.imports to authenticated;

alter table public.customers
  add column import_id uuid references public.imports(id) on delete set null;

create index customers_import_id_idx
  on public.customers (import_id)
  where deleted_at is null;

drop policy if exists customers_read on public.customers;
create policy customers_read
  on public.customers
  for select
  to authenticated
  using (
    deleted_at is null
    and (
      public.has_permission('customers.view')
      or public.has_permission('customers.cards')
    )
  );

drop policy if exists student_types_read on public.student_types;
create policy student_types_read
  on public.student_types
  for select
  to authenticated
  using (
    is_active
    and (
      public.has_permission('customers.view')
      or public.has_permission('customers.create')
      or public.has_permission('customers.edit')
      or public.has_permission('customers.cards')
    )
  );

grant select (import_id) on public.customers to authenticated;

create or replace function public.log_card_print(p_count integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('customers.cards') then
    raise exception 'not allowed';
  end if;
  if p_count is null or p_count < 1 then
    raise exception 'invalid card count';
  end if;

  insert into public.audit_logs (
    actor_id, action, entity, new_value
  )
  values (
    auth.uid(),
    'cards.print',
    'customer_cards',
    jsonb_build_object('count', p_count)
  );
end;
$$;

revoke all on function public.log_card_print(integer) from public, anon;
grant execute on function public.log_card_print(integer) to authenticated;
