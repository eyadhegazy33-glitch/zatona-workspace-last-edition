begin;

create or replace function public.validate_shift_assignment_weekday()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_days integer[];
  v_active boolean;
begin
  if tg_op = 'UPDATE'
     and new.shift_id = old.shift_id
     and new.work_date = old.work_date
     and old.canceled_at is null
     and new.canceled_at is not null then
    return new;
  end if;

  select days, active into v_days, v_active
  from public.shifts
  where id = new.shift_id;
  if not found or not v_active
     or not (extract(dow from new.work_date)::integer = any(v_days)) then
    raise exception using errcode = '22023', message = 'shift is not scheduled for this weekday';
  end if;
  return new;
end;
$$;

drop trigger if exists shift_assignment_weekday_check on public.shift_assignments;
create trigger shift_assignment_weekday_check
before insert or update of shift_id, work_date, canceled_at
on public.shift_assignments
for each row execute function public.validate_shift_assignment_weekday();

revoke all on function public.validate_shift_assignment_weekday() from public, anon, authenticated;

commit;
