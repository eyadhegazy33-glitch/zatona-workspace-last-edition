-- QR tokens are bearer secrets and must only be read by card-print users.
revoke select (qr_token) on public.customers from authenticated;

create or replace function public.get_customer_qr_token(p_customer uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if not public.has_permission('customers.cards') then
    raise exception 'not allowed';
  end if;

  select c.qr_token
    into v_token
  from public.customers c
  where c.id = p_customer
    and c.deleted_at is null;

  if v_token is null then
    raise exception 'customer not found';
  end if;

  return v_token;
end;
$$;

revoke all on function public.get_customer_qr_token(uuid) from public, anon;
grant execute on function public.get_customer_qr_token(uuid) to authenticated;
