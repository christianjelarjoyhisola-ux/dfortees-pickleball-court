-- Unfinished booking-wizard rows are temporary slot holds, not bookings.
-- Discard them after an explicit cancel or expiry while preserving submitted
-- bookings as cancelled audit records.

create or replace function public.archive_deleted_booking()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  is_void boolean := current_setting('app.owner_void_booking', true) = 'on';
  reason text := nullif(current_setting('app.owner_void_reason', true), '');
  is_temporary_hold boolean :=
    old.hold_expires_at is not null
    and old.full_name like 'Reserving%'
    and old.contact_number is null
    and old.email is null
    and coalesce(old.created_via, 'customer') = 'customer';
begin
  -- Temporary holds contain no customer or payment evidence and must not
  -- clutter either the live booking list or the deleted-booking archive.
  if is_temporary_hold then
    return old;
  end if;

  insert into public.deleted_booking_archive (
    booking_ref, source, original_booking, recovery_status, deleted_at, notes,
    voided_fee_amount, void_reason, voided_at, voided_by
  ) values (
    old.ref, case when is_void then 'owner_void' else 'trigger' end, to_jsonb(old),
    case when is_void then 'voided' else 'deleted' end, now(),
    case when is_void then 'System Owner voided and deleted this booking. Fee excluded from future computation. Reason: ' || coalesce(reason, 'Not supplied')
         else 'Automatically archived before hard delete.' end,
    case when is_void and old.booking_fee_earned_at is not null then greatest(coalesce(old.booking_fee_amount_snapshot, 0), 0) else 0 end,
    case when is_void then reason end,
    case when is_void then now() end,
    case when is_void then auth.uid() end
  );
  return old;
end;
$$;

create or replace function public.expire_guest_holds()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  delete from public.bookings
   where status = 'verifying'
     and hold_expires_at is not null
     and hold_expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_guest_holds() from public, anon, authenticated;
grant execute on function public.expire_guest_holds() to service_role;

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
  select *
    into v_booking
    from public.bookings
   where ref = p_booking_ref
     and guest_access_token = p_access_token
   for update;

  if not found then
    raise exception 'Booking access was not found.' using errcode = '42501';
  end if;

  -- A non-null hold expiry identifies the pre-submission wizard hold. Once
  -- customer details are submitted, update_guest_booking clears this field.
  if v_booking.status = 'verifying' and v_booking.hold_expires_at is not null then
    delete from public.booking_slots where booking_ref = p_booking_ref;
    delete from public.bookings where ref = p_booking_ref;
    return jsonb_build_object(
      'bookingReference', p_booking_ref,
      'status', 'cancelled',
      'paymentStatus', 'rejected',
      'released', true,
      'discarded', true
    );
  end if;

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
  returning * into v_booking;

  delete from public.booking_slots where booking_ref = p_booking_ref;

  return jsonb_build_object(
    'bookingReference', v_booking.ref,
    'status', v_booking.status,
    'paymentStatus', v_booking.payment_status,
    'released', true,
    'discarded', false
  );
end;
$$;

revoke all on function public.cancel_guest_booking(text, uuid, text) from public;
grant execute on function public.cancel_guest_booking(text, uuid, text) to anon, authenticated;

-- One-time cleanup of old wizard holds which were previously retained as
-- cancelled bookings. The strict predicate excludes submitted bookings.
delete from public.bookings
 where status = 'cancelled'
   and hold_expires_at is not null
   and full_name like 'Reserving%'
   and contact_number is null
   and email is null
   and coalesce(created_via, 'customer') = 'customer'
   and payment_status in ('failed', 'rejected', 'for_verification');

notify pgrst, 'reload schema';
