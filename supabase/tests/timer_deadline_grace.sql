begin;

select plan(1);

select ok(
  lower(pg_get_functiondef('public.get_live_timers()'::regprocedure))
    like '%ops.timer_grace_minutes%'
    and lower(pg_get_functiondef('public.get_live_timers()'::regprocedure))
      like '%make_interval(mins => w + v_grace)%',
  'live timer deadline includes the configurable grace period'
);

select * from finish();
rollback;
