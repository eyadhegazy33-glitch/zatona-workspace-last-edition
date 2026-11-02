create or replace function public.audit_enrich()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  h json;
begin
  begin
    h := current_setting('request.headers', true)::json;
  exception when others then
    h := null;
  end;

  new.ip := null;
  new.user_agent := coalesce(new.user_agent, left(h->>'user-agent', 300));
  new.actor_role := coalesce(
    new.actor_role,
    (
      select r.name
      from public.profiles p
      join public.roles r on r.id = p.role_id
      where p.id = new.actor_id
    )
  );
  return new;
end $$;
