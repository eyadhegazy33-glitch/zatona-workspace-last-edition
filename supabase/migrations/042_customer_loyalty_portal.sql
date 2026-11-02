begin;

create table public.customer_loyalty_pins (
  customer_id uuid primary key references public.customers(id),
  pin_hash text not null,
  enrolled_by uuid not null references public.profiles(id),
  enrolled_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table public.customer_loyalty_sessions (
  token_hash bytea primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index customer_loyalty_sessions_customer_idx
  on public.customer_loyalty_sessions(customer_id);
create index customer_loyalty_sessions_expiry_idx
  on public.customer_loyalty_sessions(expires_at);
create index customer_loyalty_sessions_last_used_idx
  on public.customer_loyalty_sessions(last_used_at);

create table public.customer_loyalty_login_attempts (
  identity_hash bytea primary key,
  attempts integer not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until timestamptz
);
create index customer_loyalty_login_attempts_window_idx
  on public.customer_loyalty_login_attempts(window_started_at);

create table public.loyalty_settings (
  id smallint primary key default 1 check (id = 1),
  points_per_currency_unit numeric(10, 4) not null default 1
    check (points_per_currency_unit >= 0 and points_per_currency_unit <= 1000),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

insert into public.loyalty_settings (id, points_per_currency_unit)
values (1, 1)
on conflict (id) do nothing;

create table public.loyalty_rewards (
  id uuid primary key default gen_random_uuid(),
  name_en text not null check (length(btrim(name_en)) between 1 and 100),
  name_ar text not null check (length(btrim(name_ar)) between 1 and 100),
  description_en text not null default '' check (length(description_en) <= 500),
  description_ar text not null default '' check (length(description_ar) <= 500),
  points_cost integer not null check (points_cost > 0),
  stock_remaining integer check (stock_remaining is null or stock_remaining >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  reward_id uuid not null references public.loyalty_rewards(id),
  reward_name_en text not null,
  reward_name_ar text not null,
  points_cost integer not null check (points_cost > 0),
  status text not null default 'requested'
    check (status in ('requested', 'fulfilled', 'rejected')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolution_reason text
);

create index loyalty_redemptions_queue_idx
  on public.loyalty_redemptions(requested_at)
  where status = 'requested';
create index loyalty_redemptions_customer_idx
  on public.loyalty_redemptions(customer_id, requested_at desc);

create table public.loyalty_points_ledger (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.customers(id),
  points bigint not null check (points <> 0),
  entry_type text not null check (entry_type in (
    'purchase', 'purchase_void', 'manual_adjustment',
    'redemption_reserve', 'redemption_refund'
  )),
  reason text,
  receipt_id uuid references public.receipts(id),
  pos_receipt_id uuid references public.pos_receipts(id),
  redemption_id uuid references public.loyalty_redemptions(id),
  reversed_entry_id bigint references public.loyalty_points_ledger(id),
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (num_nonnulls(receipt_id, pos_receipt_id, redemption_id, reversed_entry_id) <= 1)
);

create unique index loyalty_purchase_receipt_unique
  on public.loyalty_points_ledger(receipt_id)
  where entry_type = 'purchase' and receipt_id is not null;
create unique index loyalty_purchase_pos_receipt_unique
  on public.loyalty_points_ledger(pos_receipt_id)
  where entry_type = 'purchase' and pos_receipt_id is not null;
create unique index loyalty_redemption_entry_unique
  on public.loyalty_points_ledger(redemption_id, entry_type)
  where redemption_id is not null;
create unique index loyalty_reversal_entry_unique
  on public.loyalty_points_ledger(reversed_entry_id)
  where reversed_entry_id is not null;
create index loyalty_points_customer_created_idx
  on public.loyalty_points_ledger(customer_id, created_at desc);

alter table public.customer_loyalty_pins enable row level security;
alter table public.customer_loyalty_sessions enable row level security;
alter table public.customer_loyalty_login_attempts enable row level security;
alter table public.loyalty_settings enable row level security;
alter table public.loyalty_rewards enable row level security;
alter table public.loyalty_redemptions enable row level security;
alter table public.loyalty_points_ledger enable row level security;

revoke all on public.customer_loyalty_pins,
  public.customer_loyalty_sessions,
  public.customer_loyalty_login_attempts,
  public.loyalty_settings,
  public.loyalty_rewards,
  public.loyalty_redemptions,
  public.loyalty_points_ledger
  from public, anon, authenticated;

insert into public.permissions (key, description)
values ('loyalty.manage', 'Manage customer loyalty points and rewards')
on conflict (key) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_key)
select r.id, 'loyalty.manage'
from public.roles r
where r.name in ('Admin', 'Manager')
   or r.name = 'owner'
on conflict (role_id, permission_key) do nothing;

create or replace function public.set_customer_loyalty_pin(
  p_customer uuid,
  p_pin text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  if not coalesce(public.has_permission('loyalty.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{6,12}$' then
    raise exception using errcode = '22023', message = 'PIN must contain 6 to 12 digits';
  end if;
  if not exists (
    select 1 from public.customers
    where id = p_customer and deleted_at is null
  ) then
    raise exception using errcode = 'P0002', message = 'customer not found';
  end if;

  insert into public.customer_loyalty_pins (
    customer_id, pin_hash, enrolled_by, enrolled_at, last_login_at
  )
  values (
    p_customer, extensions.crypt(p_pin, extensions.gen_salt('bf', 12)),
    auth.uid(), now(), null
  )
  on conflict (customer_id) do update
  set pin_hash = excluded.pin_hash,
      enrolled_by = excluded.enrolled_by,
      enrolled_at = now(),
      last_login_at = null;

  delete from public.customer_loyalty_sessions
  where customer_id = p_customer;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(),
    'loyalty.pin.set',
    'customer',
    p_customer::text,
    jsonb_build_object('action', 'manager_verified_pin_enrollment_or_reset')
  );
end;
$$;

create or replace function public.customer_loyalty_login(
  p_customer_code text,
  p_phone text,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_customer_id uuid;
  v_pin_hash text;
  v_token text;
  v_token_hash bytea;
  v_identity_hash bytea;
  v_attempts public.customer_loyalty_login_attempts;
  v_now timestamptz := now();
begin
  delete from public.customer_loyalty_login_attempts
  where window_started_at < v_now - interval '1 day';
  delete from public.customer_loyalty_sessions
  where expires_at <= v_now or last_used_at <= v_now - interval '30 minutes';

  if p_customer_code is null or length(p_customer_code) > 40
     or p_phone is null or length(p_phone) > 40
     or regexp_replace(p_phone, '[^0-9]', '', 'g') !~ '^[0-9]{6,15}$'
     or p_pin is null or length(p_pin) > 12
     or p_pin !~ '^[0-9]{6,12}$' then
    return jsonb_build_object('error', 'invalid_credentials');
  end if;

  v_identity_hash := extensions.digest(
    convert_to(
      upper(btrim(p_customer_code)) || ':' ||
      regexp_replace(p_phone, '[^0-9]', '', 'g'),
      'UTF8'
    ),
    'sha256'
  );

  insert into public.customer_loyalty_login_attempts (identity_hash)
  values (v_identity_hash)
  on conflict (identity_hash) do nothing;

  select * into v_attempts
  from public.customer_loyalty_login_attempts
  where identity_hash = v_identity_hash
  for update;

  if v_attempts.locked_until is not null and v_attempts.locked_until > v_now then
    return jsonb_build_object('error', 'invalid_credentials');
  end if;

  select c.id, pin.pin_hash
  into v_customer_id, v_pin_hash
  from public.customers c
  join public.customer_loyalty_pins pin on pin.customer_id = c.id
  where upper(btrim(c.code)) = upper(btrim(p_customer_code))
    and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') =
      regexp_replace(p_phone, '[^0-9]', '', 'g')
    and c.deleted_at is null
    and c.status::text <> 'blocked'
  limit 1
  for update of pin;

  if not found or extensions.crypt(p_pin, v_pin_hash) is distinct from v_pin_hash then
    update public.customer_loyalty_login_attempts
    set attempts = case
          when window_started_at < v_now - interval '15 minutes' then 1
          else attempts + 1
        end,
        window_started_at = case
          when window_started_at < v_now - interval '15 minutes' then v_now
          else window_started_at
        end,
        locked_until = case
          when (case
            when window_started_at < v_now - interval '15 minutes' then 1
            else attempts + 1
          end) >= 5 then v_now + interval '15 minutes'
          else null
        end
    where identity_hash = v_identity_hash;
    return jsonb_build_object('error', 'invalid_credentials');
  end if;

  delete from public.customer_loyalty_login_attempts
  where identity_hash = v_identity_hash;

  update public.customer_loyalty_pins
  set last_login_at = v_now
  where customer_id = v_customer_id;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := extensions.digest(v_token, 'sha256');

  insert into public.customer_loyalty_sessions (
    token_hash, customer_id, expires_at
  )
  values (v_token_hash, v_customer_id, v_now + interval '12 hours');

  return jsonb_build_object('token', v_token);
end;
$$;

create or replace function public.assert_customer_loyalty_session(p_token text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_customer uuid;
begin
  if p_token is null or length(p_token) <> 64
     or p_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '28000', message = 'customer session expired';
  end if;

  update public.customer_loyalty_sessions
  set last_used_at = now()
  where token_hash = extensions.digest(p_token, 'sha256')
    and expires_at > now()
    and last_used_at > now() - interval '30 minutes'
    and exists (
      select 1 from public.customers c
      where c.id = customer_loyalty_sessions.customer_id
        and c.deleted_at is null
        and c.status::text <> 'blocked'
    )
  returning customer_id into v_customer;

  if v_customer is null then
    raise exception using errcode = '28000', message = 'customer session expired';
  end if;
  return v_customer;
end;
$$;

create or replace function public.get_customer_loyalty_portal(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_customer uuid;
  v_result jsonb;
begin
  v_customer := public.assert_customer_loyalty_session(p_token);

  select jsonb_build_object(
    'customer', jsonb_build_object(
      'id', c.id,
      'code', c.code,
      'name', c.full_name
    ),
    'points', coalesce((
      select sum(ledger.points)
      from public.loyalty_points_ledger ledger
      where ledger.customer_id = c.id
    ), 0),
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', reward.id,
        'name_en', reward.name_en,
        'name_ar', reward.name_ar,
        'description_en', reward.description_en,
        'description_ar', reward.description_ar,
        'points_cost', reward.points_cost,
        'stock_remaining', reward.stock_remaining
      ) order by reward.sort_order, reward.name_en)
      from public.loyalty_rewards reward
      where reward.is_active
        and (reward.stock_remaining is null or reward.stock_remaining > 0)
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', history.id,
        'points', history.points,
        'entry_type', history.entry_type,
        'created_at', history.created_at
      ) order by history.created_at desc)
      from (
        select ledger.id, ledger.points, ledger.entry_type, ledger.created_at
        from public.loyalty_points_ledger ledger
        where ledger.customer_id = c.id
        order by ledger.created_at desc
        limit 30
      ) history
    ), '[]'::jsonb),
    'redemptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', redemption.id,
        'reward_name_en', redemption.reward_name_en,
        'reward_name_ar', redemption.reward_name_ar,
        'points_cost', redemption.points_cost,
        'status', redemption.status,
        'requested_at', redemption.requested_at,
        'resolution_reason', redemption.resolution_reason
      ) order by redemption.requested_at desc)
      from (
        select customer_redemptions.id, customer_redemptions.reward_name_en,
          customer_redemptions.reward_name_ar, customer_redemptions.points_cost,
          customer_redemptions.status, customer_redemptions.requested_at,
          customer_redemptions.resolution_reason
        from public.loyalty_redemptions customer_redemptions
        where customer_redemptions.customer_id = c.id
        order by customer_redemptions.requested_at desc
        limit 20
      ) redemption
    ), '[]'::jsonb)
  )
  into v_result
  from public.customers c
  where c.id = v_customer
    and c.deleted_at is null;

  if v_result is null then
    raise exception using errcode = '28000', message = 'customer session expired';
  end if;
  return v_result;
end;
$$;

create or replace function public.request_customer_loyalty_reward(
  p_token text,
  p_reward uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_customer uuid;
  v_reward public.loyalty_rewards;
  v_balance bigint;
  v_redemption uuid;
begin
  v_customer := public.assert_customer_loyalty_session(p_token);
  perform 1 from public.customers where id = v_customer for update;
  if not exists (
    select 1 from public.customers
    where id = v_customer and deleted_at is null and status::text <> 'blocked'
  ) then
    raise exception using errcode = '28000', message = 'customer session expired';
  end if;

  select * into v_reward
  from public.loyalty_rewards
  where id = p_reward and is_active
  for update;
  if not found or (v_reward.stock_remaining is not null and v_reward.stock_remaining < 1) then
    raise exception using errcode = 'P0002', message = 'reward is unavailable';
  end if;

  select coalesce(sum(points), 0) into v_balance
  from public.loyalty_points_ledger
  where customer_id = v_customer;
  if v_balance < v_reward.points_cost then
    raise exception using errcode = '22023', message = 'not enough points';
  end if;

  insert into public.loyalty_redemptions (
    customer_id, reward_id, reward_name_en, reward_name_ar, points_cost
  )
  values (
    v_customer, v_reward.id, v_reward.name_en, v_reward.name_ar,
    v_reward.points_cost
  )
  returning id into v_redemption;

  insert into public.loyalty_points_ledger (
    customer_id, points, entry_type, redemption_id
  )
  values (
    v_customer, -v_reward.points_cost, 'redemption_reserve', v_redemption
  );

  if v_reward.stock_remaining is not null then
    update public.loyalty_rewards
    set stock_remaining = stock_remaining - 1,
        updated_at = now()
    where id = v_reward.id;
  end if;
end;
$$;

create or replace function public.customer_loyalty_logout(p_token text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  if p_token is not null and length(p_token) = 64
     and p_token ~ '^[0-9a-f]{64}$' then
    delete from public.customer_loyalty_sessions
    where token_hash = extensions.digest(p_token, 'sha256');
  end if;
end;
$$;

create or replace function public.loyalty_purchase_from_receipt_line()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_customer uuid;
  v_points bigint;
begin
  if new.line_type <> 'order' or new.order_id is null then
    return new;
  end if;

  select o.customer_id
  into v_customer
  from public.orders o
  join public.receipts r on r.id = new.receipt_id
  where o.id = new.order_id
    and o.customer_id = r.customer_id
    and r.status = 'paid';

  if v_customer is null then
    return new;
  end if;

  perform 1 from public.customers where id = v_customer for update;

  select floor(
    coalesce(sum(line.amount), 0) *
    (select settings.points_per_currency_unit
     from public.loyalty_settings settings where settings.id = 1)
  )::bigint
  into v_points
  from public.receipt_lines line
  where line.receipt_id = new.receipt_id
    and line.line_type = 'order';

  if v_points > 0 then
    insert into public.loyalty_points_ledger (
      customer_id, points, entry_type, receipt_id
    )
    values (v_customer, v_points, 'purchase', new.receipt_id)
    on conflict (receipt_id) where entry_type = 'purchase'
      and receipt_id is not null do nothing;
  end if;
  return new;
end;
$$;

create or replace function public.loyalty_purchase_from_pos_receipt()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_customer uuid;
  v_points bigint;
begin
  if new.order_id is null then
    return new;
  end if;

  select order_row.customer_id
  into v_customer
  from public.pos_orders order_row
  where order_row.id = new.order_id;
  if v_customer is null then
    return new;
  end if;

  perform 1 from public.customers where id = v_customer for update;

  select floor(
    new.total *
    (select settings.points_per_currency_unit
     from public.loyalty_settings settings where settings.id = 1)
  )::bigint into v_points;

  if v_points > 0 then
    insert into public.loyalty_points_ledger (
      customer_id, points, entry_type, pos_receipt_id
    )
    values (v_customer, v_points, 'purchase', new.id)
    on conflict (pos_receipt_id) where entry_type = 'purchase'
      and pos_receipt_id is not null do nothing;
  end if;
  return new;
end;
$$;

create or replace function public.loyalty_reverse_receipt_points()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_purchase record;
begin
  if old.status <> 'paid' or new.status <> 'voided' then
    return new;
  end if;

  for v_purchase in
    select id, customer_id, points
    from public.loyalty_points_ledger
    where receipt_id = new.id and entry_type = 'purchase'
  loop
    perform 1 from public.customers where id = v_purchase.customer_id for update;
    insert into public.loyalty_points_ledger (
      customer_id, points, entry_type, reversed_entry_id, actor_id,
      reason
    )
    values (
      v_purchase.customer_id, -v_purchase.points, 'purchase_void',
      v_purchase.id, new.voided_by, new.void_reason
    )
    on conflict (reversed_entry_id) where reversed_entry_id is not null
      do nothing;
  end loop;
  return new;
end;
$$;

create or replace function public.loyalty_reverse_pos_receipt_points()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_purchase record;
begin
  for v_purchase in
    select id, customer_id, points
    from public.loyalty_points_ledger
    where pos_receipt_id = new.receipt_id and entry_type = 'purchase'
  loop
    perform 1 from public.customers where id = v_purchase.customer_id for update;
    insert into public.loyalty_points_ledger (
      customer_id, points, entry_type, reversed_entry_id, actor_id,
      reason
    )
    values (
      v_purchase.customer_id, -v_purchase.points, 'purchase_void',
      v_purchase.id, new.voided_by, new.reason
    )
    on conflict (reversed_entry_id) where reversed_entry_id is not null
      do nothing;
  end loop;
  return new;
end;
$$;

create or replace function public.prevent_loyalty_ledger_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception using errcode = '55000', message = 'loyalty ledger is immutable';
end;
$$;

create trigger receipt_lines_loyalty_purchase
after insert on public.receipt_lines
for each row execute function public.loyalty_purchase_from_receipt_line();

create trigger pos_receipts_loyalty_purchase
after insert on public.pos_receipts
for each row execute function public.loyalty_purchase_from_pos_receipt();

create trigger receipts_loyalty_void
after update of status on public.receipts
for each row execute function public.loyalty_reverse_receipt_points();

create trigger pos_receipt_voids_loyalty_reversal
after insert on public.pos_receipt_voids
for each row execute function public.loyalty_reverse_pos_receipt_points();

create trigger loyalty_points_ledger_immutable
before update or delete on public.loyalty_points_ledger
for each row execute function public.prevent_loyalty_ledger_change();

create or replace function public.set_loyalty_earn_rate(p_points_per_currency_unit numeric)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not coalesce(public.has_permission('loyalty.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_points_per_currency_unit is null
     or p_points_per_currency_unit < 0
     or p_points_per_currency_unit > 1000 then
    raise exception using errcode = '22023', message = 'invalid points rate';
  end if;

  update public.loyalty_settings
  set points_per_currency_unit = p_points_per_currency_unit,
      updated_by = auth.uid(),
      updated_at = now()
  where id = 1;

  insert into public.audit_logs (actor_id, action, entity, new_value)
  values (
    auth.uid(), 'loyalty.settings.update', 'loyalty_settings',
    jsonb_build_object('points_per_currency_unit', p_points_per_currency_unit)
  );
end;
$$;

create or replace function public.save_loyalty_reward(
  p_id uuid,
  p_name_en text,
  p_name_ar text,
  p_description_en text,
  p_description_ar text,
  p_points_cost integer,
  p_stock_remaining integer,
  p_is_active boolean,
  p_sort_order integer
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if not coalesce(public.has_permission('loyalty.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_name_en is null or length(btrim(p_name_en)) not between 1 and 100
     or p_name_ar is null or length(btrim(p_name_ar)) not between 1 and 100
     or length(coalesce(p_description_en, '')) > 500
     or length(coalesce(p_description_ar, '')) > 500
     or p_points_cost is null or p_points_cost not between 1 and 100000000
     or (p_stock_remaining is not null and p_stock_remaining < 0)
     or p_sort_order is null or p_sort_order not between -100000 and 100000
     or p_is_active is null then
    raise exception using errcode = '22023', message = 'invalid reward details';
  end if;

  if p_id is null then
    insert into public.loyalty_rewards (
      name_en, name_ar, description_en, description_ar,
      points_cost, stock_remaining, is_active, sort_order, created_by
    )
    values (
      btrim(p_name_en), btrim(p_name_ar), coalesce(p_description_en, ''),
      coalesce(p_description_ar, ''), p_points_cost, p_stock_remaining,
      coalesce(p_is_active, true), p_sort_order, auth.uid()
    )
    returning id into v_id;
  else
    update public.loyalty_rewards
    set name_en = btrim(p_name_en),
        name_ar = btrim(p_name_ar),
        description_en = coalesce(p_description_en, ''),
        description_ar = coalesce(p_description_ar, ''),
        points_cost = p_points_cost,
        stock_remaining = p_stock_remaining,
        is_active = coalesce(p_is_active, false),
        sort_order = p_sort_order,
        updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception using errcode = 'P0002', message = 'reward not found';
    end if;
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'loyalty.reward.save', 'loyalty_reward', v_id::text,
    jsonb_build_object(
      'name_en', btrim(p_name_en),
      'points_cost', p_points_cost,
      'is_active', p_is_active,
      'stock_remaining', p_stock_remaining
    )
  );
  return v_id;
end;
$$;

create or replace function public.adjust_customer_loyalty_points(
  p_customer_code text,
  p_points integer,
  p_reason text
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_customer uuid;
  v_balance bigint;
begin
  if not coalesce(public.has_permission('loyalty.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_customer_code is null or length(btrim(p_customer_code)) > 40
     or p_points is null or p_points = 0 or abs(p_points::bigint) > 1000000
     or length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'invalid points adjustment';
  end if;

  select id into v_customer
  from public.customers
  where upper(btrim(code)) = upper(btrim(p_customer_code))
    and deleted_at is null
  for update;
  if v_customer is null then
    raise exception using errcode = 'P0002', message = 'customer not found';
  end if;

  select coalesce(sum(points), 0) into v_balance
  from public.loyalty_points_ledger
  where customer_id = v_customer;
  if v_balance + p_points < 0 then
    raise exception using errcode = '22023', message = 'adjustment would make points negative';
  end if;

  insert into public.loyalty_points_ledger (
    customer_id, points, entry_type, reason, actor_id
  )
  values (
    v_customer, p_points, 'manual_adjustment', btrim(p_reason), auth.uid()
  );

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'loyalty.points.adjust', 'customer', v_customer::text,
    jsonb_build_object('points', p_points, 'reason', btrim(p_reason))
  );

  return v_balance + p_points;
end;
$$;

create or replace function public.resolve_loyalty_redemption(
  p_redemption uuid,
  p_status text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_redemption public.loyalty_redemptions;
begin
  if not coalesce(public.has_permission('loyalty.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;
  if p_status is null or p_status not in ('fulfilled', 'rejected')
     or length(coalesce(p_reason, '')) > 500
     or (p_status = 'rejected' and length(btrim(coalesce(p_reason, ''))) not between 3 and 500) then
    raise exception using errcode = '22023', message = 'invalid redemption resolution';
  end if;

  select * into v_redemption
  from public.loyalty_redemptions
  where id = p_redemption
  for update;
  if not found or v_redemption.status <> 'requested' then
    raise exception using errcode = 'P0002', message = 'redemption not found or already resolved';
  end if;

  update public.loyalty_redemptions
  set status = p_status,
      resolved_at = now(),
      resolved_by = auth.uid(),
      resolution_reason = case when p_status = 'rejected' then btrim(p_reason) else null end
  where id = p_redemption;

  if p_status = 'rejected' then
    insert into public.loyalty_points_ledger (
      customer_id, points, entry_type, redemption_id, actor_id, reason
    )
    values (
      v_redemption.customer_id, v_redemption.points_cost,
      'redemption_refund', v_redemption.id, auth.uid(), btrim(p_reason)
    );
    update public.loyalty_rewards
    set stock_remaining = stock_remaining + 1,
        updated_at = now()
    where id = v_redemption.reward_id
      and stock_remaining is not null;
  end if;

  insert into public.audit_logs (actor_id, action, entity, entity_id, new_value)
  values (
    auth.uid(), 'loyalty.redemption.resolve', 'loyalty_redemption',
    p_redemption::text,
    jsonb_build_object('status', p_status, 'reason', nullif(btrim(coalesce(p_reason, '')), ''))
  );
end;
$$;

create or replace function public.get_loyalty_admin_data()
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if not coalesce(public.has_permission('loyalty.manage'), false) then
    raise exception using errcode = '42501', message = 'not allowed';
  end if;

  select jsonb_build_object(
    'points_per_currency_unit',
      (select points_per_currency_unit from public.loyalty_settings where id = 1),
    'rewards', coalesce((
      select jsonb_agg(to_jsonb(reward) order by reward.sort_order, reward.name_en)
      from public.loyalty_rewards reward
    ), '[]'::jsonb),
    'redemptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', redemption.id,
        'customer_id', redemption.customer_id,
        'customer_name', customer.full_name,
        'customer_code', customer.code,
        'reward_id', redemption.reward_id,
        'reward_name_en', redemption.reward_name_en,
        'reward_name_ar', redemption.reward_name_ar,
        'points_cost', redemption.points_cost,
        'status', redemption.status,
        'requested_at', redemption.requested_at,
        'resolution_reason', redemption.resolution_reason
      ) order by redemption.requested_at)
      from public.loyalty_redemptions redemption
      join public.customers customer on customer.id = redemption.customer_id
      where redemption.status = 'requested'
    ), '[]'::jsonb)
  )
  into v_result;
  return v_result;
end;
$$;

revoke all on function public.set_customer_loyalty_pin(uuid, text)
  from public, anon;
revoke all on function public.customer_loyalty_login(text, text, text)
  from public, anon, authenticated;
revoke all on function public.assert_customer_loyalty_session(text)
  from public, anon, authenticated;
revoke all on function public.get_customer_loyalty_portal(text)
  from public, anon, authenticated;
revoke all on function public.request_customer_loyalty_reward(text, uuid)
  from public, anon, authenticated;
revoke all on function public.customer_loyalty_logout(text)
  from public, anon, authenticated;
revoke all on function public.loyalty_purchase_from_receipt_line()
  from public, anon, authenticated;
revoke all on function public.loyalty_purchase_from_pos_receipt()
  from public, anon, authenticated;
revoke all on function public.loyalty_reverse_receipt_points()
  from public, anon, authenticated;
revoke all on function public.loyalty_reverse_pos_receipt_points()
  from public, anon, authenticated;
revoke all on function public.prevent_loyalty_ledger_change()
  from public, anon, authenticated;
revoke all on function public.set_loyalty_earn_rate(numeric)
  from public, anon;
revoke all on function public.save_loyalty_reward(uuid, text, text, text, text, integer, integer, boolean, integer)
  from public, anon;
revoke all on function public.adjust_customer_loyalty_points(text, integer, text)
  from public, anon;
revoke all on function public.resolve_loyalty_redemption(uuid, text, text)
  from public, anon;
revoke all on function public.get_loyalty_admin_data()
  from public, anon;

grant execute on function public.set_customer_loyalty_pin(uuid, text)
  to authenticated;
grant execute on function public.customer_loyalty_login(text, text, text)
  to anon, authenticated;
grant execute on function public.get_customer_loyalty_portal(text)
  to anon, authenticated;
grant execute on function public.request_customer_loyalty_reward(text, uuid)
  to anon, authenticated;
grant execute on function public.customer_loyalty_logout(text)
  to anon, authenticated;
grant execute on function public.set_loyalty_earn_rate(numeric)
  to authenticated;
grant execute on function public.save_loyalty_reward(uuid, text, text, text, text, integer, integer, boolean, integer)
  to authenticated;
grant execute on function public.adjust_customer_loyalty_points(text, integer, text)
  to authenticated;
grant execute on function public.resolve_loyalty_redemption(uuid, text, text)
  to authenticated;
grant execute on function public.get_loyalty_admin_data()
  to authenticated;

commit;
