create index if not exists profiles_pending_created_at_idx
  on public.profiles (created_at)
  where status = 'pending' and deleted_at is null;

create index if not exists profiles_active_role_idx
  on public.profiles (role_id)
  where status = 'active' and deleted_at is null;

create index if not exists role_permissions_permission_role_idx
  on public.role_permissions (permission_key, role_id);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
