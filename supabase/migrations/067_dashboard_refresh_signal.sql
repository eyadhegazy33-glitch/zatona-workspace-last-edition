begin;

create table public.dashboard_refresh_signal (
  id boolean primary key default true check (id),
  updated_at timestamptz not null default now()
);

insert into public.dashboard_refresh_signal (id)
values (true)
on conflict (id) do nothing;

alter table public.dashboard_refresh_signal enable row level security;
create policy dashboard_refresh_signal_read
  on public.dashboard_refresh_signal for select to authenticated
  using (
    public.has_permission('dashboard.view')
    or public.has_permission('dashboard.occupancy')
  );
grant select on public.dashboard_refresh_signal to authenticated;
revoke insert, update, delete, truncate on public.dashboard_refresh_signal from public, anon, authenticated;

create or replace function public.touch_dashboard_refresh_signal()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.dashboard_refresh_signal (id, updated_at)
  values (true, clock_timestamp())
  on conflict (id) do update
  set updated_at = excluded.updated_at;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger dashboard_refresh_pos_orders
after insert or update or delete on public.pos_orders
for each row execute function public.touch_dashboard_refresh_signal();

create trigger dashboard_refresh_pos_receipts
after insert or update or delete on public.pos_receipts
for each row execute function public.touch_dashboard_refresh_signal();

create trigger dashboard_refresh_pos_receipt_voids
after insert or update or delete on public.pos_receipt_voids
for each row execute function public.touch_dashboard_refresh_signal();

create trigger dashboard_refresh_resources
after insert or update or delete on public.resources
for each row execute function public.touch_dashboard_refresh_signal();

alter publication supabase_realtime add table public.dashboard_refresh_signal;

revoke execute on function public.touch_dashboard_refresh_signal() from public, anon, authenticated;

commit;
