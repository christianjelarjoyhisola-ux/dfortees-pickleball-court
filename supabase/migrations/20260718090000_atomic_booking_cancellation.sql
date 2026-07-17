-- Cancel bookings and release their court-hour locks in one transaction.
-- This migration changes no active booking, court, pricing, payment, or venue
-- setting. The cleanup at the end removes only stale inactive booking locks.

create or replace function public.sync_booking_slots()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_slot text;
  v_hour integer;
begin
  -- Remove the old lock set first. Inactive holds return below without
  -- recreating it, so status change and slot release share one transaction.
  delete from public.booking_slots where booking_ref = new.ref;

  if new.status in ('cancelled', 'forfeited')
     or (
       new.status = 'verifying'
       and new.hold_expires_at is not null
       and new.hold_expires_at <= now()
     ) then
    return new;
  end if;

  if new.slots is null or cardinality(new.slots) = 0 then
    raise exception 'Booking must contain at least one time slot.'
      using errcode = '22000';
  end if;

  foreach v_slot in array new.slots loop
    if trim(coalesce(v_slot, '')) !~ '^([0-9]|1[0-9]|2[0-3])$' then
      raise exception 'Booking contains an invalid time slot.'
        using errcode = '22000';
    end if;
    v_hour := trim(v_slot)::integer;
    insert into public.booking_slots(booking_ref, court_id, booking_date, start_hour)
    values (new.ref, new.court_id, new.date, v_hour);
  end loop;

  return new;
exception
  when unique_violation then
    raise exception 'One or more time slots are already booked and no longer available.'
      using errcode = '23505';
end;
$$;

revoke all on function public.sync_booking_slots() from public;

drop trigger if exists trg_sync_booking_slots on public.bookings;
create trigger trg_sync_booking_slots
after insert or update of court_id, date, slots, status, hold_expires_at
on public.bookings
for each row execute function public.sync_booking_slots();

create or replace function public.cancel_authenticated_booking(
  p_booking_ref text,
  p_payment_status text default null,
  p_reason text default 'Cancelled by dashboard user'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_account_role();
  v_booking public.bookings%rowtype;
begin
  if v_role is null or v_role not in ('owner', 'court_owner', 'staff', 'host') then
    raise exception 'This account cannot cancel bookings.' using errcode = '42501';
  end if;

  select *
    into v_booking
    from public.bookings
   where ref = p_booking_ref
   for update;

  if not found then
    raise exception 'Booking was not found.' using errcode = 'P0002';
  end if;

  if v_role = 'host'
     and (
       not coalesce(v_booking.host_booking, false)
       or v_booking.host_user_id is distinct from auth.uid()
     ) then
    raise exception 'Hosts may only cancel their own bookings.' using errcode = '42501';
  end if;

  update public.bookings
     set status = 'cancelled',
         payment_status = case
           when nullif(trim(coalesce(p_payment_status, '')), '') is null then payment_status
           else p_payment_status
         end,
         forfeiture_reason = coalesce(
           left(nullif(trim(coalesce(p_reason, '')), ''), 250),
           forfeiture_reason
         )
   where ref = p_booking_ref
  returning * into v_booking;

  -- Defense in depth: the trigger already removes these locks. This explicit
  -- delete keeps the cancellation contract self-contained on legacy installs.
  delete from public.booking_slots where booking_ref = p_booking_ref;

  return jsonb_build_object(
    'bookingReference', v_booking.ref,
    'status', v_booking.status,
    'paymentStatus', v_booking.payment_status,
    'released', true
  );
end;
$$;

revoke all on function public.cancel_authenticated_booking(text, text, text) from public;
grant execute on function public.cancel_authenticated_booking(text, text, text) to authenticated;

create or replace function public.cancel_guest_booking(
  p_booking_ref text,
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
  update public.bookings
     set status = 'cancelled',
         payment_status = case
           when payment_status in ('unpaid', 'pending', 'for_verification') then 'rejected'
           else payment_status
         end,
         forfeiture_reason = left(nullif(trim(coalesce(p_reason, '')), ''), 250)
   where ref = p_booking_ref
     and guest_access_token = p_access_token
  returning * into v_booking;

  if not found then
    raise exception 'Booking access was not found.' using errcode = '42501';
  end if;

  delete from public.booking_slots where booking_ref = p_booking_ref;

  return jsonb_build_object(
    'bookingReference', v_booking.ref,
    'status', v_booking.status,
    'paymentStatus', v_booking.payment_status,
    'released', true
  );
end;
$$;

revoke all on function public.cancel_guest_booking(text, uuid, text) from public;
grant execute on function public.cancel_guest_booking(text, uuid, text) to anon, authenticated;

-- Repair only locks which are already stale. No active booking is changed.
delete from public.booking_slots as locked
using public.bookings as booking
where locked.booking_ref = booking.ref
  and (
    booking.status in ('cancelled', 'forfeited')
    or (
      booking.status = 'verifying'
      and booking.hold_expires_at is not null
      and booking.hold_expires_at <= now()
    )
  );

notify pgrst, 'reload schema';
