-- Restore D'fortees' canonical per-hour booking fee after live settings drift.
--
-- This forward-only repair updates pricing configuration, not existing
-- bookings, payment records, receipts, or reserved slots. The aliases remain
-- synchronized because older application paths may read any one of them.

do $$
declare
  v_fee numeric;
begin
  insert into public.settings as current_setting (key, value)
  values
    ('maintenance_fee', '5'),
    ('service_fee_rate', '5'),
    ('booking_fee', '5'),
    ('fee_type', 'per_hour')
  on conflict (key) do update
    set value = excluded.value,
        updated_at = now()
  where current_setting.value is distinct from excluded.value;

  v_fee := public.calculate_booking_service_fee(array['17']::text[]);
  if v_fee is distinct from 5::numeric then
    raise exception
      'D''fortees booking-fee verification failed (expected 5, got %).',
      v_fee;
  end if;
end;
$$;
