begin;

insert into public.role_permissions (role_id, permission_key)
select r.id, 'audit.export'
from public.roles r
where r.name = 'Manager'
on conflict (role_id, permission_key) do nothing;

commit;
