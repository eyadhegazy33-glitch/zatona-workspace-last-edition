begin;

alter table public.imports
  add column if not exists user_id uuid references public.profiles(id),
  add column if not exists filename text,
  add column if not exists total integer not null default 0,
  add column if not exists created integer not null default 0,
  add column if not exists updated integer not null default 0,
  add column if not exists skipped integer not null default 0,
  add column if not exists failed integer not null default 0,
  add column if not exists rolled_back_at timestamptz;

update public.imports
set user_id = created_by
where user_id is null
  and created_by is not null;

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

revoke execute on function public.import_customers(jsonb, text, boolean)
  from public, anon;
grant execute on function public.import_customers(jsonb, text, boolean)
  to authenticated;

commit;
