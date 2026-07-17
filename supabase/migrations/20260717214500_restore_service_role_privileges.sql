-- Restore the standard Supabase server-role privileges required by trusted
-- Edge Functions. The service role remains server-only and bypasses RLS;
-- anonymous and authenticated browser grants are not broadened here.

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public
  to service_role;
grant usage, select on all sequences in schema public
  to service_role;

-- Keep future server-owned tables and identity sequences usable by deployed
-- Edge Functions without relying on platform-specific implicit defaults.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;

do $$
begin
  if not has_table_privilege('service_role', 'public.bookings', 'SELECT')
     or not has_table_privilege('service_role', 'public.bookings', 'UPDATE')
     or not has_table_privilege('service_role', 'public.receipt_verifications', 'INSERT') then
    raise exception 'Service-role privilege repair did not pass verification.';
  end if;
end;
$$;
