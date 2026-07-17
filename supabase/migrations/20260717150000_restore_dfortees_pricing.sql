-- Restore D'fortees' canonical court pricing after a live configuration drift.
--
-- This forward repair changes only the c1 court configuration and the shared
-- pricing setting. Existing booking rates, totals, slots, and payment records
-- remain untouched. Conditional writes make repeat execution a no-op once the
-- expected values are already present.

do $$
declare
  v_day_rate numeric;
  v_evening_rate numeric;
  v_rate_schedule constant jsonb :=
    '[{"from":6,"to":18,"rate":60},{"from":18,"to":24,"rate":90}]'::jsonb;
begin
  if not exists (select 1 from public.courts where id = 'c1') then
    raise exception 'Cannot restore D''fortees pricing: court c1 does not exist.';
  end if;

  update public.courts
     set rate = 60,
         rate_schedule = v_rate_schedule
   where id = 'c1'
     and (
       rate is distinct from 60::numeric
       or rate_schedule is distinct from v_rate_schedule
     );

  insert into public.settings as current_setting (key, value)
  values ('pricing_tiers', v_rate_schedule::text)
  on conflict (key) do update
    set value = excluded.value,
        updated_at = now()
  where current_setting.value is distinct from excluded.value;

  -- Exercise the same authoritative function used by guest availability,
  -- booking creation, payment sessions, and receipt verification.
  v_day_rate := public.calculate_booking_court_total('c1', array['17']::text[]);
  v_evening_rate := public.calculate_booking_court_total('c1', array['18']::text[]);

  if v_day_rate is distinct from 60::numeric
     or v_evening_rate is distinct from 90::numeric then
    raise exception
      'D''fortees pricing verification failed (17:00=%, 18:00=%).',
      v_day_rate,
      v_evening_rate;
  end if;
end;
$$;
