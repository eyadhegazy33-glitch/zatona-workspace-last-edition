begin;

create trigger dashboard_refresh_checkins
after insert or update or delete on public.checkins
for each row execute function public.touch_dashboard_refresh_signal();

create trigger dashboard_refresh_orders
after insert or update or delete on public.orders
for each row execute function public.touch_dashboard_refresh_signal();

create trigger dashboard_refresh_receipts
after insert or update or delete on public.receipts
for each row execute function public.touch_dashboard_refresh_signal();

create trigger dashboard_refresh_fees
after insert or update or delete on public.fees
for each row execute function public.touch_dashboard_refresh_signal();

create trigger dashboard_refresh_alerts
after insert or update or delete on public.alerts
for each row execute function public.touch_dashboard_refresh_signal();

create trigger dashboard_refresh_incidents
after insert or update or delete on public.incidents
for each row execute function public.touch_dashboard_refresh_signal();

commit;
