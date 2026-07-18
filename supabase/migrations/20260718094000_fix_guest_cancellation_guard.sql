-- Guest cancellations must not write to host forfeiture audit fields.
-- guard_host_payment_deadline intentionally rejects anonymous changes to
-- forfeiture_reason, so cancellation metadata has its own dedicated columns.

alter table public.bookings
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;

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
         cancelled_at = coalesce(cancelled_at, now()),
         cancellation_reason = coalesce(
           left(nullif(trim(coalesce(p_reason, '')), ''), 250),
           cancellation_reason
         )
   where ref = p_booking_ref
  returning * into v_booking;

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
         cancelled_at = coalesce(cancelled_at, now()),
         cancellation_reason = coalesce(
           left(nullif(trim(coalesce(p_reason, '')), ''), 250),
           cancellation_reason
         )
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

notify pgrst, 'reload schema';
