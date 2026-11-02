insert into public.permissions (key, description)
values
  ('customers.view', 'View customer records and visit history'),
  ('customers.create', 'Create customer records'),
  ('customers.edit', 'Edit and change customer status'),
  ('customers.delete', 'Soft-delete customer records'),
  ('customers.import', 'Import customer records'),
  ('customers.cards', 'Print customer cards and manage QR tokens'),
  ('resources.manage', 'Manage seats, rooms, and tables'),
  ('checkins.manage', 'Check customers in and out'),
  ('scanner.use', 'Scan customer cards')
on conflict (key) do update
set description = excluded.description;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.name = 'Admin'
  and (
    p.key like 'customers.%'
    or p.key in ('resources.manage', 'checkins.manage', 'scanner.use')
  )
on conflict (role_id, permission_key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.name = 'Admin'
  and p.key in ('dashboard.view', 'accounts.approve', 'employees.view',
                'employees.manage', 'roles.manage', 'settings.manage',
                'audit.view')
on conflict (role_id, permission_key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
join public.permissions p
  on p.key in (
    'customers.view',
    'customers.create',
    'customers.edit',
    'customers.cards',
    'checkins.manage',
    'scanner.use'
  )
where r.name = 'Reception'
on conflict (role_id, permission_key) do nothing;
