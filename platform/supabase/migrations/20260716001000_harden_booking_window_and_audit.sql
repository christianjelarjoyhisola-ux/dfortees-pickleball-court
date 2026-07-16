-- Hardening found during destructive fixture cleanup and boundary testing.

begin;

create or replace function public.write_tenant_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_entity_id text;
  v_old_data jsonb;
  v_new_data jsonb;
begin
  if tg_op = 'INSERT' then
    v_new_data := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_old_data := to_jsonb(old);
    v_new_data := to_jsonb(new);
  else
    v_old_data := to_jsonb(old);
  end if;

  v_tenant_id := coalesce(
    (v_new_data ->> 'tenant_id')::uuid,
    (v_old_data ->> 'tenant_id')::uuid
  );
  v_entity_id := coalesce(
    v_new_data ->> 'id',
    v_old_data ->> 'id',
    v_new_data ->> 'key',
    v_old_data ->> 'key'
  );

  -- Cascading a platform-only tenant deletion removes the tenant before some
  -- child-table AFTER triggers run. In that narrow case there is no surviving
  -- tenant to own an audit record, so allow the cascade to finish cleanly.
  if not exists (select 1 from public.tenants where id = v_tenant_id) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  insert into public.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    v_entity_id,
    v_old_data,
    v_new_data
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.validate_booking_window()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_tenant public.tenants%rowtype;
  v_local_now timestamp;
  v_maximum_days integer;
  v_minimum_minutes integer;
  v_first_slot integer;
begin
  select * into v_tenant from public.tenants where id = new.tenant_id;
  if not found then
    raise exception using errcode = '23503', message = 'Booking tenant does not exist.';
  end if;

  v_local_now := now() at time zone v_tenant.timezone;
  v_maximum_days := greatest(
    0,
    least(365, coalesce((v_tenant.booking_settings ->> 'maximumAdvanceDays')::integer, 60))
  );
  v_minimum_minutes := greatest(
    0,
    least(10080, coalesce((v_tenant.booking_settings ->> 'minimumAdvanceMinutes')::integer, 0))
  );
  select min(slot) into v_first_slot from unnest(new.slots) slot;

  if new.booking_date < v_local_now::date then
    raise exception using errcode = 'P0001', message = 'Booking date cannot be in the past.';
  end if;
  if new.booking_date > v_local_now::date + v_maximum_days then
    raise exception using errcode = 'P0001', message = 'Booking date is outside the available booking window.';
  end if;
  if new.booking_date + make_interval(hours => v_first_slot)
       < v_local_now + make_interval(mins => v_minimum_minutes) then
    raise exception using errcode = 'P0001', message = 'A selected time is too soon to book.';
  end if;
  return new;
end;
$$;

create trigger bookings_validate_window
  before insert or update of tenant_id, booking_date, slots on public.bookings
  for each row execute function public.validate_booking_window();

create trigger tenant_settings_set_updated_at
  before update on public.tenant_settings
  for each row execute function public.set_updated_at();

commit;

