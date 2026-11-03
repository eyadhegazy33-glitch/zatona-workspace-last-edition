begin;

select plan(5);

select ok(
  exists (
    select 1 from public.permissions
    where key = 'loyalty.view'
  ),
  'loyalty data view permission is available in the catalog'
);

select ok(
  exists (
    select 1 from public.permissions
    where key = 'loyalty.redemptions.fulfill'
  ),
  'redemption resolution permission is available in the catalog'
);

select ok(
  exists (
    select 1 from public.permissions
    where key = 'loyalty.portal.issue'
  ),
  'loyalty portal code permission is available in the catalog'
);

select ok(
  (
    select count(*) = 3
    from public.roles r
    join public.role_permissions rp on rp.role_id = r.id
    where r.name = 'Reception'
      and rp.permission_key in (
        'loyalty.view',
        'loyalty.redemptions.fulfill',
        'loyalty.portal.issue'
      )
  ),
  'Reception can view loyalty data, resolve redemptions, and issue portal codes'
);

select ok(
  not exists (
    select 1
    from public.roles r
    join public.role_permissions rp on rp.role_id = r.id
    where r.name = 'Reception'
      and rp.permission_key = 'loyalty.manage'
  ),
  'Reception does not receive full loyalty administration'
);

select * from finish();
rollback;
