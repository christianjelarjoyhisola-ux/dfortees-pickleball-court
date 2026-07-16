-- Complete the public customer bridge with safe rate display and token-bound
-- guest cancellation. No booking PII is exposed.

begin;

create or replace function public.get_public_tenant(p_tenant_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', t.id,
    'slug', t.slug,
    'name', t.name,
    'timezone', t.timezone,
    'address', t.address,
    'locality', t.locality,
    'phone', t.phone,
    'facebookUrl', t.facebook_url,
    'logoPath', t.logo_path,
    'tagline', t.tagline,
    'currency', t.currency,
    'theme', jsonb_build_object('primary', t.primary_color, 'accent', t.accent_color),
    'bookingSettings', t.booking_settings,
    'courts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'slug', c.slug,
        'name', c.name,
        'description', c.description,
        'environment', c.environment,
        'openHour', c.open_hour,
        'closeHour', c.close_hour,
        'rate', coalesce((
          select min(rr.rate_php) from public.court_rate_rules rr
          where rr.tenant_id = c.tenant_id and rr.court_id = c.id and rr.is_active
        ), 0),
        'rateSchedule', coalesce((
          select jsonb_agg(jsonb_build_object(
            'from', rr.start_hour,
            'to', rr.end_hour,
            'rate', rr.rate_php,
            'daysOfWeek', rr.days_of_week
          ) order by rr.start_hour, rr.end_hour)
          from public.court_rate_rules rr
          where rr.tenant_id = c.tenant_id and rr.court_id = c.id and rr.is_active
        ), '[]'::jsonb)
      ) order by c.sort_order, c.name)
      from public.courts c
      where c.tenant_id = t.id and c.is_active
    ), '[]'::jsonb)
  )
  from public.tenants t
  where t.slug = lower(btrim(p_tenant_slug))
    and t.status = 'active';
$$;

create or replace function public.cancel_guest_booking(
  p_tenant_slug text,
  p_booking_reference text,
  p_access_token uuid,
  p_reason text default 'Cancelled by guest'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
begin
  select b.* into v_booking
  from public.bookings b
  join public.tenants t on t.id = b.tenant_id
  where t.slug = lower(btrim(p_tenant_slug))
    and b.booking_reference = upper(btrim(p_booking_reference))
    and b.guest_access_token = p_access_token
  for update of b;

  if not found then
    raise exception using errcode = 'P0001', message = 'Booking not found.';
  end if;
  if v_booking.status not in ('pending', 'confirmed') then
    raise exception using errcode = 'P0001', message = 'This booking can no longer be cancelled online.';
  end if;

  update public.bookings
     set status = 'cancelled',
         cancelled_at = now(),
         cancellation_reason = left(coalesce(nullif(btrim(p_reason), ''), 'Cancelled by guest'), 500)
   where tenant_id = v_booking.tenant_id and id = v_booking.id
   returning * into v_booking;

  return jsonb_build_object(
    'bookingReference', v_booking.booking_reference,
    'status', v_booking.status,
    'cancelledAt', v_booking.cancelled_at
  );
end;
$$;

revoke all on function public.cancel_guest_booking(text, text, uuid, text) from public;
grant execute on function public.cancel_guest_booking(text, text, uuid, text) to anon, authenticated;

commit;

