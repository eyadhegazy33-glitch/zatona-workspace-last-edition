begin;

insert into public.role_permissions (role_id, permission_key)
select role_row.id, permission_row.permission_key
from public.roles role_row
cross join (
  values
    ('inventory.view'),
    ('inventory.manage'),
    ('inventory.adjust')
) as permission_row(permission_key)
where role_row.name = 'owner'
on conflict (role_id, permission_key) do nothing;

commit;
