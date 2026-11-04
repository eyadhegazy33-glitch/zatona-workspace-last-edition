begin;

select plan(3);

select ok(
  has_function_privilege(
    'authenticated',
    'public.get_checkout_quote(bigint)',
    'execute'
  ),
  'authenticated checkout staff can request the amount due'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.get_checkout_quote(bigint)',
    'execute'
  ),
  'anonymous users cannot request a checkout quote'
);

select ok(
  lower(pg_get_functiondef('public.get_checkout_quote(bigint)'::regprocedure))
    like '%accrue_fees(p_checkin)%'
    and lower(pg_get_functiondef('public.get_checkout_quote(bigint)'::regprocedure))
      like '%sum(total)%'
    and lower(pg_get_functiondef('public.get_checkout_quote(bigint)'::regprocedure))
      like '%sum(fee.amount)%',
  'checkout quote includes current timer accrual, orders, and outstanding visit fees'
);

select * from finish();
rollback;
