begin;

select plan(13);

select ok(
  has_function_privilege(
    'authenticated',
    'public.list_receipts(timestamptz,timestamptz,text,text,text,uuid,numeric,numeric,integer,integer)',
    'EXECUTE'
  ),
  'authenticated users can call list_receipts'
);
select ok(
  has_function_privilege('authenticated', 'public.get_receipt(uuid)', 'EXECUTE'),
  'authenticated users can call get_receipt'
);
select ok(
  has_function_privilege('authenticated', 'public.get_my_shift()', 'EXECUTE'),
  'authenticated users can call get_my_shift'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.get_team_shifts(timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'authenticated users can call get_team_shifts'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.list_receipts(timestamptz,timestamptz,text,text,text,uuid,numeric,numeric,integer,integer)',
    'EXECUTE'
  ),
  'anonymous users cannot call list_receipts'
);
select ok(
  not has_function_privilege('anon', 'public.get_receipt(uuid)', 'EXECUTE'),
  'anonymous users cannot call get_receipt'
);
select ok(
  not has_function_privilege('anon', 'public.get_my_shift()', 'EXECUTE'),
  'anonymous users cannot call get_my_shift'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.get_team_shifts(timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'anonymous users cannot call get_team_shifts'
);

select ok(
  has_table_privilege('authenticated', 'public.receipts', 'SELECT'),
  'authenticated users have receipt table select privilege'
);
select ok(
  has_table_privilege('authenticated', 'public.shift_sessions', 'SELECT'),
  'authenticated users have shift session select privilege'
);
select ok(
  not has_table_privilege('authenticated', 'public.receipts', 'INSERT'),
  'authenticated users cannot insert receipts directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.shift_sessions', 'INSERT'),
  'authenticated users cannot insert shift sessions directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.shift_assignments', 'DELETE'),
  'authenticated users cannot delete shift assignment history'
);

select * from finish();

rollback;
