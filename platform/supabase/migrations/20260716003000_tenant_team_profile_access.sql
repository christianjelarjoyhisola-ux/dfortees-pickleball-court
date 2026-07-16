-- Allow an active tenant team to see only the basic profiles of colleagues in
-- the same tenant. This supports the owner/staff directory without auth.users.

begin;

create or replace function public.shares_active_tenant(p_other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.tenant_memberships mine
    join public.tenant_memberships theirs
      on theirs.tenant_id = mine.tenant_id
     and theirs.status = 'active'
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and mine.role in ('owner', 'staff')
      and theirs.user_id = p_other_user_id
  );
$$;

drop policy profiles_read_self_or_platform on public.profiles;
create policy profiles_read_self_tenant_or_platform on public.profiles for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_platform_admin()
    or public.shares_active_tenant(user_id)
  );

commit;

