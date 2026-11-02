begin;

insert into public.permissions (key, description)
values ('menu.availability', 'Mark menu items available or sold out')
on conflict (key) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.name = 'Barista'
  and p.key = 'menu.availability'
on conflict (role_id, permission_key) do nothing;

drop policy if exists pos_menu_categories_admin_read
  on public.pos_menu_categories;
create policy pos_menu_categories_admin_read
  on public.pos_menu_categories for select to authenticated
  using (coalesce(public.has_permission('menu.manage'), false));

drop policy if exists pos_menu_categories_admin_insert
  on public.pos_menu_categories;
create policy pos_menu_categories_admin_insert
  on public.pos_menu_categories for insert to authenticated
  with check (coalesce(public.has_permission('menu.manage'), false));

drop policy if exists pos_menu_categories_admin_update
  on public.pos_menu_categories;
create policy pos_menu_categories_admin_update
  on public.pos_menu_categories for update to authenticated
  using (coalesce(public.has_permission('menu.manage'), false))
  with check (coalesce(public.has_permission('menu.manage'), false));

grant select, insert, update on public.pos_menu_categories to authenticated;

drop policy if exists pos_products_admin_read on public.pos_products;
create policy pos_products_admin_read
  on public.pos_products for select to authenticated
  using (
    coalesce(public.has_permission('menu.manage'), false)
    or coalesce(public.has_permission('menu.availability'), false)
  );

drop policy if exists pos_products_admin_insert on public.pos_products;
create policy pos_products_admin_insert
  on public.pos_products for insert to authenticated
  with check (coalesce(public.has_permission('menu.manage'), false));

drop policy if exists pos_products_admin_update on public.pos_products;
create policy pos_products_admin_update
  on public.pos_products for update to authenticated
  using (
    coalesce(public.has_permission('menu.manage'), false)
    or coalesce(public.has_permission('menu.availability'), false)
  )
  with check (
    coalesce(public.has_permission('menu.manage'), false)
    or coalesce(public.has_permission('menu.availability'), false)
  );

grant select, insert, update on public.pos_products to authenticated;

create or replace function public.guard_menu_availability_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if coalesce(public.has_permission('menu.manage'), false) then
    return new;
  end if;

  if coalesce(public.has_permission('menu.availability'), false)
     and (to_jsonb(new) - 'available') is not distinct from
         (to_jsonb(old) - 'available') then
    return new;
  end if;

  raise exception using errcode = '42501', message = 'not allowed';
end;
$$;

drop trigger if exists pos_products_guard_menu_availability
  on public.pos_products;
create trigger pos_products_guard_menu_availability
  before update on public.pos_products
  for each row execute function public.guard_menu_availability_update();

commit;
