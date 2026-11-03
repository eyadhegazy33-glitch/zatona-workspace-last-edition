begin;

select plan(2);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'list_audit_scans'
      and pg_get_function_arguments(p.oid) like '%p_from timestamp with time zone%'
      and pg_get_function_arguments(p.oid) like '%p_to timestamp with time zone%'
  ),
  'scan-list RPC accepts start and end timestamp filters'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.list_audit_scans(text,timestamp with time zone,timestamp with time zone,integer,integer)',
    'execute'
  ),
  'authenticated audit viewers can call the date-filtered scan-list RPC'
);

select * from finish();
rollback;
