begin;

select plan(1);

select ok(
  exists (
    select 1
    from public.roles r
    join public.role_permissions rp on rp.role_id = r.id
    where r.name = 'Manager'
      and rp.permission_key = 'audit.export'
  ),
  'Managers who can view the audit log can export filtered audit data'
);

select * from finish();
rollback;
