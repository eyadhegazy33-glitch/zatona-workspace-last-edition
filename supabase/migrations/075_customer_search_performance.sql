create extension if not exists pg_trgm;

create index if not exists customers_full_name_trgm_idx
  on public.customers using gin (full_name gin_trgm_ops)
  where deleted_at is null;

create index if not exists customers_code_trgm_idx
  on public.customers using gin (code gin_trgm_ops)
  where deleted_at is null;

create index if not exists customers_phone_trgm_idx
  on public.customers using gin (phone gin_trgm_ops)
  where deleted_at is null and phone is not null;
