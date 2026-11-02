begin;

select plan(57);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles has row level security enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.customers'::regclass),
  'customers has row level security enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.pos_orders'::regclass),
  'orders has row level security enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.pos_receipts'::regclass),
  'receipts has row level security enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.audit_logs'::regclass),
  'audit logs have row level security enabled'
);

select ok(not exists (
  select 1 from pg_policies
  where schemaname = 'public' and tablename = 'profiles'
    and 'anon' = any(roles) and cmd in ('SELECT', 'ALL')
), 'anon has no profiles read policy');
select ok(not exists (
  select 1 from pg_policies
  where schemaname = 'public' and tablename = 'customers'
    and 'anon' = any(roles) and cmd in ('SELECT', 'ALL')
), 'anon has no customers read policy');
select ok(not exists (
  select 1 from pg_policies
  where schemaname = 'public' and tablename = 'pos_orders'
    and 'anon' = any(roles) and cmd in ('SELECT', 'ALL')
), 'anon has no orders read policy');
select ok(not exists (
  select 1 from pg_policies
  where schemaname = 'public' and tablename = 'pos_receipts'
    and 'anon' = any(roles) and cmd in ('SELECT', 'ALL')
), 'anon has no receipts read policy');
select ok(not exists (
  select 1 from pg_policies
  where schemaname = 'public' and tablename = 'audit_logs'
    and 'anon' = any(roles) and cmd in ('SELECT', 'ALL')
), 'anon has no audit log read policy');

select ok(not has_function_privilege('anon', 'public.has_permission(text)', 'EXECUTE'),
  'anon cannot execute the permission helper');
select ok(not has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE'),
  'anon cannot execute the auth trigger');
select ok(not has_function_privilege('anon', 'public.audit_row()', 'EXECUTE'),
  'anon cannot execute the audit trigger');
select ok(not has_function_privilege('anon', 'public.audit_enrich()', 'EXECUTE'),
  'anon cannot execute the audit enrichment trigger');
select ok(not has_function_privilege('anon', 'public.incident_after_insert()', 'EXECUTE'),
  'anon cannot execute the incident trigger');
select ok(not has_function_privilege('anon', 'public.alert_after_insert()', 'EXECUTE'),
  'anon cannot execute the alert trigger');
select ok(not has_function_privilege('anon', 'public.restore_timer_fee_when_receipt_voided()', 'EXECUTE'),
  'anon cannot execute the fee receipt trigger');
select ok(not has_function_privilege('anon', 'public.approve_account(uuid,uuid)', 'EXECUTE'),
  'anon cannot approve accounts');
select ok(not has_function_privilege('anon', 'public.reject_account(uuid,text)', 'EXECUTE'),
  'anon cannot reject accounts');

select ok(not has_function_privilege('authenticated', 'public.current_alert_candidates()', 'EXECUTE'),
  'authenticated users cannot generate alert candidates');
select ok(not has_function_privilege('authenticated', 'public.generate_alerts()', 'EXECUTE'),
  'authenticated users cannot run the alert scheduler');
select ok(not has_function_privilege('authenticated', 'public.process_bookings()', 'EXECUTE'),
  'authenticated users cannot run the booking scheduler');

select ok(not exists (
  select 1 from pg_policies
  where schemaname = 'public'
    and tablename in (
      'inventory_items', 'inventory_movements', 'bookings', 'incidents',
      'incident_events', 'qc_submissions', 'qc_answers', 'feedback',
      'alerts', 'audit_logs'
    )
    and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    and (roles @> array['authenticated']::name[] or roles @> array['anon']::name[] or 'public' = any(roles))
), 'browser roles have no direct-write policies for protected phase-four data');

select ok(not has_table_privilege('authenticated', 'public.audit_logs', 'UPDATE'),
  'authenticated users cannot update audit rows directly');
select ok(not has_table_privilege('authenticated', 'public.audit_logs', 'DELETE'),
  'authenticated users cannot delete audit rows directly');

select ok(exists (
  select 1 from pg_trigger where tgrelid = 'public.receipts'::regclass
    and tgname = 'receipts_no_delete' and not tgisinternal
), 'receipts reject deletion');
select ok(exists (
  select 1 from pg_trigger where tgrelid = 'public.receipts'::regclass
    and tgname = 'receipts_guard_trg' and not tgisinternal
), 'receipt updates are guarded');
select ok(exists (
  select 1 from pg_trigger where tgrelid = 'public.receipt_lines'::regclass
    and tgname = 'receipt_lines_immutable' and not tgisinternal
), 'receipt lines are immutable');

select ok(exists (
  select 1 from pg_constraint
  where conrelid = 'public.bookings'::regclass
    and conname = 'bookings_no_overlap' and contype = 'x'
), 'booking overlap is enforced by an exclusion constraint');
select ok(exists (
  select 1 from pg_index
  where indrelid = 'public.checkins'::regclass and indisunique
    and pg_get_expr(indpred, indrelid) like '%checked_out_at IS NULL%'
), 'only one open check-in per customer is enforced by a unique index');

select ok(not exists (
  select 1
  from public.roles r
  join public.role_permissions rp on rp.role_id = r.id
  where r.name = 'Reception'
    and rp.permission_key in (
      'accounts.approve', 'orders.discount', 'receipts.void', 'fees.waive', 'audit.view'
    )
), 'Reception has no approval, discount, void, waive, or audit permission');
select ok(not exists (
  select 1
  from public.roles r
  join public.role_permissions rp on rp.role_id = r.id
  where r.name = 'Barista'
    and rp.permission_key in ('orders.create', 'customers.view')
), 'Barista cannot create orders or read customers');

select ok(not exists (
  select 1
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, '{}')) config
      where config like 'search_path=%'
    )
), 'all public security-definer functions fix search_path');

insert into public.customers (
  id, code, qr_token, first_name, last_name, birth_date, student_type_id
)
select
  '00000000-0000-4000-8000-000000000101',
  'ZT-PGTAP-101',
  'pgtap-fake-token-101',
  'Fake',
  'Test One',
  date '2000-01-01',
  st.id
from public.student_types st
order by st.id
limit 1;

insert into public.customers (
  id, code, qr_token, first_name, last_name, birth_date, student_type_id
)
select
  '00000000-0000-4000-8000-000000000102',
  'ZT-PGTAP-102',
  'pgtap-fake-token-102',
  'Fake',
  'Test Two',
  date '2000-01-02',
  st.id
from public.student_types st
order by st.id
limit 1;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  (
    '00000000-0000-4000-8000-000000000201',
    'authenticated',
    'authenticated',
    'pgtap-pending@example.invalid',
    'fake-test-password-hash',
    now(),
    '{}'::jsonb,
    jsonb_build_object(
      'first_name', 'Fake',
      'last_name', 'Pending',
      'requested_role_id', (select id from public.roles where name = 'Admin')
    )
  ),
  (
    '00000000-0000-4000-8000-000000000202',
    'authenticated',
    'authenticated',
    'pgtap-reception@example.invalid',
    'fake-test-password-hash',
    now(),
    '{}'::jsonb,
    '{"first_name":"Fake","last_name":"Reception"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000203',
    'authenticated',
    'authenticated',
    'pgtap-barista@example.invalid',
    'fake-test-password-hash',
    now(),
    '{}'::jsonb,
    '{"first_name":"Fake","last_name":"Barista"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000204',
    'authenticated',
    'authenticated',
    'pgtap-manager@example.invalid',
    'fake-test-password-hash',
    now(),
    '{}'::jsonb,
    '{"first_name":"Fake","last_name":"Manager"}'::jsonb
  );

select ok(
  (select requested_role_id is null from public.profiles
   where id = '00000000-0000-4000-8000-000000000201'),
  'registering with Admin as requested role clears the request'
);

update public.profiles
set status = 'active',
    role_id = (select id from public.roles where name = 'Reception')
where id = '00000000-0000-4000-8000-000000000202';
update public.profiles
set status = 'active',
    role_id = (select id from public.roles where name = 'Barista')
where id = '00000000-0000-4000-8000-000000000203';
update public.profiles
set status = 'active',
    role_id = (select id from public.roles where name = 'Manager')
where id = '00000000-0000-4000-8000-000000000204';

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000201', true);
set local role authenticated;
select is(
  (select count(*) from public.customers
   where id = '00000000-0000-4000-8000-000000000101'),
  0::bigint,
  'pending users cannot read customers'
);
reset role;

update public.profiles
set status = 'active',
    role_id = (select id from public.roles where name = 'Admin')
where id = '00000000-0000-4000-8000-000000000201';

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000204', true);
set local role authenticated;
select throws_ok(
  $$select public.update_employee(
      '00000000-0000-4000-8000-000000000201',
      'Fake',
      'Admin',
      (select id from public.roles where name = 'Reception')
    )$$,
  'P0001',
  'not allowed to manage an Admin role',
  'Manager cannot edit an Admin'
);
reset role;
insert into public.role_permissions (role_id, permission_key)
select id, 'roles.manage' from public.roles where name = 'Manager'
on conflict do nothing;
set local role authenticated;
select throws_ok(
  $$select public.soft_delete_employee('00000000-0000-4000-8000-000000000204')$$,
  'P0001',
  'cannot delete yourself',
  'employees cannot delete themselves'
);
select throws_ok(
  $$select public.soft_delete_employee('00000000-0000-4000-8000-000000000201')$$,
  'P0001',
  'cannot delete the last active Admin',
  'the last active Admin cannot be deleted'
);
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000202', true);
set local role authenticated;
select throws_ok(
  $$select public.approve_account(
      '00000000-0000-4000-8000-000000000201',
      (select id from public.roles where name = 'Reception')
    )$$,
  '42501',
  'not allowed',
  'Reception cannot approve accounts'
);
select throws_ok(
  $$select public.create_order(
      '00000000-0000-4000-8000-000000000101',
      '[{"menu_item_id":"00000000-0000-4000-8000-000000000301","quantity":1}]'::jsonb,
      null,
      1,
      'fake discount reason'
    )$$,
  '42501',
  'discount not allowed',
  'Reception cannot create a discounted order'
);
select throws_ok(
  $$select public.void_pos_receipt(
      '00000000-0000-4000-8000-000000000302',
      'fake void reason'
    )$$,
  '42501',
  'not allowed',
  'Reception cannot void receipts'
);
select throws_ok(
  $$select public.waive_fee(
      '00000000-0000-4000-8000-000000000303',
      'fake waiver reason'
    )$$,
  'P0001',
  'not allowed',
  'Reception cannot waive fees'
);
select is(
  (select count(*) from public.audit_logs),
  0::bigint,
  'Reception cannot read audit logs'
);
reset role;

update public.customers
set status = 'blocked'
where id = '00000000-0000-4000-8000-000000000101';
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000202', true);
set local role authenticated;
select throws_ok(
  $$select public.check_in('00000000-0000-4000-8000-000000000101', null)$$,
  'P0001',
  'customer not allowed to enter',
  'check_in refuses a blocked customer'
);
reset role;

update public.customers
set status = 'active',
    expires_on = date '2000-01-01'
where id = '00000000-0000-4000-8000-000000000101';
set local role authenticated;
select throws_ok(
  $$select public.check_in('00000000-0000-4000-8000-000000000101', null)$$,
  'P0001',
  'customer not allowed to enter',
  'check_in refuses an expired customer'
);
reset role;

update public.customers
set expires_on = null
where id = '00000000-0000-4000-8000-000000000101';
set local role authenticated;
select lives_ok(
  $$select public.check_in('00000000-0000-4000-8000-000000000102', null)$$,
  'check_in opens a fake customer visit'
);
select throws_ok(
  $$select public.check_in('00000000-0000-4000-8000-000000000102', null)$$,
  'P0001',
  'already checked in',
  'check_in refuses a second open visit'
);
reset role;

update public.customers
set qr_token = 'pgtap-fake-token-reissued'
where id = '00000000-0000-4000-8000-000000000101';
set local role authenticated;
select is(
  public.scan_customer('pgtap-fake-token-101')->>'reason',
  'unknown',
  're-issuing a QR token makes the old token unknown'
);
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000203', true);
set local role authenticated;
select throws_ok(
  $$select public.create_order(
      '00000000-0000-4000-8000-000000000101',
      '[]'::jsonb,
      null,
      0,
      null
    )$$,
  '42501',
  'not allowed',
  'Barista cannot create orders'
);
select is(
  (select count(*) from public.customers),
  0::bigint,
  'Barista cannot read customers'
);
reset role;

insert into public.resources (id, type, name, capacity)
values ('00000000-0000-4000-8000-000000000103', 'room', 'PGTAP fake room', 4);

select lives_ok(
  $$insert into public.bookings (id, customer_id, resource_id, starts_at, ends_at)
    values (
      '00000000-0000-4000-8000-000000000104',
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000103',
      '2099-01-01 10:00:00+00',
      '2099-01-01 11:00:00+00'
    )$$,
  'fake first booking is inserted'
);
select throws_ok(
  $$insert into public.bookings (id, customer_id, resource_id, starts_at, ends_at)
    values (
      '00000000-0000-4000-8000-000000000105',
      '00000000-0000-4000-8000-000000000102',
      '00000000-0000-4000-8000-000000000103',
      '2099-01-01 10:30:00+00',
      '2099-01-01 11:30:00+00'
    )$$,
  '23P01',
  null,
  'overlapping fake booking is rejected by the database'
);

select lives_ok(
  $$insert into public.checkins (id, customer_id)
    values (
      '00000000-0000-4000-8000-000000000106',
      '00000000-0000-4000-8000-000000000101'
    )$$,
  'fake customer can have one open check-in'
);
select throws_ok(
  $$insert into public.checkins (id, customer_id)
    values (
      '00000000-0000-4000-8000-000000000107',
      '00000000-0000-4000-8000-000000000101'
    )$$,
  '23505',
  null,
  'second fake open check-in is rejected'
);

create temporary table pgtap_audit_fixture (id bigint) on commit drop;
select set_config(
  'request.headers',
  '{"x-forwarded-for":"203.0.113.2"}',
  true
);
with inserted as (
  insert into public.audit_logs (action, entity, entity_id, ip)
  values ('pgtap.fake', 'test', 'fake-id', null)
  returning id
)
insert into pgtap_audit_fixture select id from inserted;

select ok(
  (select l.ip is null
   from public.audit_logs l
   join pgtap_audit_fixture f on f.id = l.id),
  'audit enrichment does not trust a caller-supplied IP address'
);
select throws_ok(
  format(
    'update public.audit_logs set action = %L where id = %s',
    'pgtap.changed',
    (select id from pgtap_audit_fixture)
  ),
  '55000',
  null,
  'audit rows cannot be updated'
);
select throws_ok(
  format(
    'delete from public.audit_logs where id = %s',
    (select id from pgtap_audit_fixture)
  ),
  '55000',
  null,
  'audit rows cannot be deleted'
);

select * from finish();
rollback;
