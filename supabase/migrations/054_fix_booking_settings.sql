begin;

create or replace function public.get_booking_settings()
returns table (
  currency_code text,
  time_zone text
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_currency text;
  v_time_zone text;
begin
  if not coalesce(public.has_permission('bookings.view'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select coalesce(
           nullif(settings.value #>> '{}', ''),
           'EGP'
         )
  into v_currency
  from (select 1) anchor
  left join public.settings settings
    on settings.key = 'ops.currency_code';

  if v_currency !~ '^[A-Z]{3}$' then
    v_currency := 'EGP';
  end if;

  select coalesce(
           (
             select settings.value #>> '{}'
             from public.settings settings
             where settings.key = 'ops.time_zone'
           ),
           (
             select settings.value #>> '{}'
             from public.settings settings
             where settings.key = 'ops.timezone'
           ),
           'Africa/Cairo'
         )
  into v_time_zone;

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names timezone
    where timezone.name = v_time_zone
  ) then
    v_time_zone := 'Africa/Cairo';
  end if;

  return query select v_currency, v_time_zone;
end;
$$;

revoke all on function public.get_booking_settings() from public, anon;
grant execute on function public.get_booking_settings() to authenticated;

commit;
