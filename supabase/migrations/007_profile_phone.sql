alter table public.profiles
  add column if not exists phone_number text;

alter table public.profiles
  add constraint profiles_phone_number_valid
  check (
    phone_number is null
    or (
      phone_number ~ '^[+]?[0-9(). -]{7,24}$'
      and length(regexp_replace(phone_number, '[^0-9]', '', 'g')) between 7 and 15
    )
  );

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  req uuid;
  phone text;
begin
  phone := nullif(btrim(new.raw_user_meta_data->>'phone_number'), '');
  if phone is null
     or phone !~ '^[+]?[0-9(). -]{7,24}$'
     or length(regexp_replace(phone, '[^0-9]', '', 'g')) not between 7 and 15 then
    raise exception 'A valid phone number is required';
  end if;

  begin
    req := nullif(new.raw_user_meta_data->>'requested_role_id','')::uuid;
  exception when others then
    req := null;
  end;

  if req is not null and not exists (
    select 1 from public.roles where id = req and is_registrable
  ) then
    req := null;
  end if;

  insert into public.profiles (
    id, first_name, last_name, phone_number, email, requested_role_id
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name',''),
    coalesce(new.raw_user_meta_data->>'last_name',''),
    phone,
    new.email,
    req
  );

  insert into public.notifications (user_id, type, payload)
  select p.id, 'account_pending',
         jsonb_build_object('user_id', new.id, 'email', new.email)
  from public.profiles p
  join public.role_permissions rp on rp.role_id = p.role_id
  where rp.permission_key = 'accounts.approve'
    and p.status = 'active'
    and p.id <> new.id;

  insert into public.audit_logs (actor_id, action, entity, entity_id)
  values (new.id, 'account.register', 'profile', new.id::text);

  return new;
end $$;
