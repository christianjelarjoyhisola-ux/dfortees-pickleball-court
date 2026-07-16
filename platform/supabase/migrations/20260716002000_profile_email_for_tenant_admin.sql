-- Store the application login email in the RLS-protected profile so tenant
-- owners can manage memberships without exposing auth.users.

begin;

alter table public.profiles add column email text;

update public.profiles p
set email = lower(u.email)
from auth.users u
where u.id = p.user_id and u.email is not null;

create unique index profiles_email_unique
  on public.profiles (lower(email)) where email is not null;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (user_id, email, display_name)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (user_id) do update set email = excluded.email;

  if new.email is not null and exists (
    select 1 from public.platform_admin_allowlist a where a.email = lower(new.email)
  ) then
    insert into public.platform_admins (user_id) values (new.id)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

commit;

