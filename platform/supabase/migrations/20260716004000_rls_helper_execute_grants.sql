-- RLS policies execute these helpers as the authenticated caller. Keep the
-- helpers narrow and explicitly grant only the minimum execute permissions.

begin;

revoke all on function public.is_platform_admin() from public, anon;
revoke all on function public.has_tenant_role(uuid, public.membership_role[]) from public, anon;
revoke all on function public.storage_tenant_id(text) from public, anon;
revoke all on function public.shares_active_tenant(uuid) from public, anon;

grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.has_tenant_role(uuid, public.membership_role[]) to authenticated;
grant execute on function public.storage_tenant_id(text) to authenticated;
grant execute on function public.shares_active_tenant(uuid) to authenticated;

commit;

