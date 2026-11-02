revoke execute on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.audit_row() from public, anon, authenticated;
revoke execute on function public.audit_enrich() from public, anon, authenticated;
revoke execute on function public.incident_after_insert() from public, anon, authenticated;
revoke execute on function public.alert_after_insert() from public, anon, authenticated;
revoke execute on function public.restore_timer_fee_when_receipt_voided() from public, anon, authenticated;

revoke execute on function public.approve_account(uuid, uuid) from public, anon;
revoke execute on function public.reject_account(uuid, text) from public, anon;
grant execute on function public.approve_account(uuid, uuid) to authenticated;
grant execute on function public.reject_account(uuid, text) to authenticated;
