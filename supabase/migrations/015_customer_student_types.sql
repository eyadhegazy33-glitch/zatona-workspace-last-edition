create table if not exists public.student_types (
  id uuid primary key default gen_random_uuid(),
  name_en text not null unique,
  name_ar text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.student_types enable row level security;
grant select on public.student_types to authenticated;

drop policy if exists student_types_active_read on public.student_types;
create policy student_types_active_read
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

insert into public.student_types (name_en, name_ar, is_active)
values
  ('American Student', 'طالب أمريكي', true),
  ('Invited Student', 'طالب مدعو', true)
on conflict (name_en) do update
set name_ar = excluded.name_ar,
    is_active = true;

update public.student_types
set is_active = false
where name_en not in ('American Student', 'Invited Student')
  and is_active;
