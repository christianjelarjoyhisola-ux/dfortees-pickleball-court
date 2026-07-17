-- Dedicated single-tenant security baseline for D'fortees Pickleball Court.
-- Apply after SETUP_NEW_SUPABASE.sql and the retained follow-up migrations.
-- This migration intentionally removes every anonymous table write path.

create extension if not exists pgcrypto;

alter table public.bookings
  add column if not exists guest_access_token uuid,
  add column if not exists idempotency_key uuid,
  add column if not exists hold_expires_at timestamptz;

update public.bookings
set guest_access_token = gen_random_uuid()
where guest_access_token is null;

alter table public.bookings
  alter column guest_access_token set default gen_random_uuid(),
  alter column guest_access_token set not null;

create unique index if not exists bookings_idempotency_key_unique
  on public.bookings(idempotency_key)
  where idempotency_key is not null;

alter table public.open_play_registrations
  add column if not exists idempotency_key uuid;

create unique index if not exists open_play_registrations_idempotency_unique
  on public.open_play_registrations(idempotency_key)
  where idempotency_key is not null;

alter table public.open_play_host_session_registrations
  add column if not exists idempotency_key uuid;

create unique index if not exists open_play_host_session_registrations_idempotency_unique
  on public.open_play_host_session_registrations(idempotency_key)
  where idempotency_key is not null;

create table if not exists public.booking_slots (
  booking_ref text not null references public.bookings(ref) on delete cascade,
  court_id text not null,
  booking_date date not null,
  start_hour smallint not null check (start_hour between 0 and 23),
  created_at timestamptz not null default now(),
  primary key (court_id, booking_date, start_hour),
  unique (booking_ref, start_hour)
);

create index if not exists booking_slots_booking_ref_idx
  on public.booking_slots(booking_ref);

alter table public.booking_slots enable row level security;

drop trigger if exists check_booking_conflict on public.bookings;
drop trigger if exists trg_guard_public_booking_hold_update on public.bookings;

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

drop trigger if exists trg_sync_booking_slots on public.bookings;
create trigger trg_sync_booking_slots
after insert or update of court_id, date, slots, status, hold_expires_at
on public.bookings
for each row execute function public.sync_booking_slots();

insert into public.booking_slots(booking_ref, court_id, booking_date, start_hour)
select b.ref, b.court_id, b.date, slot_value::smallint
from public.bookings b
cross join lateral unnest(b.slots) slot_value
where b.status not in ('cancelled', 'forfeited')
  and not (
    b.status = 'verifying'
    and b.hold_expires_at is not null
    and b.hold_expires_at <= now()
  )
  and trim(slot_value) ~ '^([0-9]|1[0-9]|2[0-3])$'
on conflict do nothing;

create or replace function public.expire_guest_holds()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.bookings
     set status = 'cancelled',
         payment_status = case
           when payment_status in ('paid', 'downpayment_paid') then payment_status
           else 'failed'
         end
   where status = 'verifying'
     and hold_expires_at is not null
     and hold_expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_guest_holds() from public, anon, authenticated;
grant execute on function public.expire_guest_holds() to service_role;

create or replace function public.payment_method_is_enabled(p_method text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when lower(coalesce(p_method, '')) = 'cash' then
      coalesce((select value <> '0' from public.settings where key = 'payment_method_cash'), true)
    when lower(coalesce(p_method, '')) in ('gcash','bdopay','maya','bpi','gotyme','pnb') then
      coalesce((
        select value = '1'
        from public.settings
        where key = 'payment_method_' || lower(p_method)
      ), false)
    else false
  end
$$;

revoke all on function public.payment_method_is_enabled(text) from public, anon, authenticated;

create or replace function public.get_public_settings()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from public.settings
  where key = any(array[
    'venue_name','venue_address','venue_phone','venue_facebook',
    'open_hour','close_hour','pricing_tiers',
    'open_play_config','maintenance_config',
    'maintenance_fee','service_fee_rate','booking_fee','fee_type',
    'payment_acceptance_mode',
    'payment_method_cash','payment_method_gcash','payment_method_bdopay',
    'payment_method_maya','payment_method_bpi','payment_method_gotyme',
    'payment_method_pnb','gcash_merchant_number','gcash_merchant_name',
    'gcash_qr_image','gotyme_merchant_number','gotyme_merchant_name',
    'gotyme_qr_image','pnb_merchant_number','pnb_merchant_name',
    'pnb_qr_image','gcash_checkout_enabled','gcash_checkout_url'
  ]::text[])
$$;

revoke all on function public.get_public_settings() from public;
grant execute on function public.get_public_settings() to anon, authenticated;

create or replace function public.get_public_availability(p_booking_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_open integer := 6;
  v_close integer := 24;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_hour integer := extract(hour from (now() at time zone 'Asia/Manila'))::integer;
  v_date_blocked boolean;
  v_result jsonb;
begin
  if p_booking_date is null then
    raise exception 'A booking date is required.' using errcode = '22000';
  end if;

  perform public.expire_guest_holds();

  select coalesce(
    (select value::integer from public.settings
      where key in ('open_hour','open_time')
      order by case key when 'open_hour' then 1 else 2 end limit 1),
    6
  ) into v_open;
  select coalesce(
    (select value::integer from public.settings
      where key in ('close_hour','close_time')
      order by case key when 'close_hour' then 1 else 2 end limit 1),
    24
  ) into v_close;
  v_open := greatest(0, least(23, v_open));
  v_close := greatest(v_open + 1, least(24, v_close));

  select exists(select 1 from public.blocked_dates where date = p_booking_date)
    into v_date_blocked;

  select jsonb_build_object(
    'courts',
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'slots', slot_rows.slots
      )
      order by c.id
    ), '[]'::jsonb)
  )
  into v_result
  from public.courts c
  cross join lateral (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'startHour', hours.start_hour,
        'price', public.calculate_booking_court_total(c.id, array[hours.start_hour::text]),
        'available', (
          not c.blocked
          and not v_date_blocked
          and p_booking_date >= v_today
          and not (p_booking_date = v_today and hours.start_hour <= v_hour)
          and bs.booking_ref is null
        ),
        'state', case
          when p_booking_date < v_today
            or (p_booking_date = v_today and hours.start_hour <= v_hour) then 'done'
          when c.blocked or v_date_blocked then 'booked'
          when b.status = 'verifying' then 'processing'
          when b.status = 'completed' then 'done'
          when bs.booking_ref is not null then 'booked'
          else 'available'
        end
      )
      order by hours.start_hour
    ), '[]'::jsonb) as slots
    from generate_series(v_open, v_close - 1) as hours(start_hour)
    left join public.booking_slots bs
      on bs.court_id = c.id
     and bs.booking_date = p_booking_date
     and bs.start_hour = hours.start_hour
    left join public.bookings b on b.ref = bs.booking_ref
  ) slot_rows;

  return coalesce(v_result, jsonb_build_object('courts', '[]'::jsonb));
end;
$$;

revoke all on function public.get_public_availability(date) from public;
grant execute on function public.get_public_availability(date) to anon, authenticated;

create or replace function public.create_guest_booking(
  p_booking jsonb,
  p_idempotency_key uuid,
  p_mode text default 'booking'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.bookings%rowtype;
  v_booking public.bookings%rowtype;
  v_ref text;
  v_group_ref text;
  v_access uuid := gen_random_uuid();
  v_court_id text;
  v_court_name text;
  v_date date;
  v_slots text[];
  v_open integer := 6;
  v_close integer := 24;
  v_court_total numeric;
  v_service_fee numeric;
  v_total numeric;
  v_method text;
  v_full_name text;
  v_phone text;
  v_email text;
  v_payment_ref text;
  v_requested_downpayment numeric;
  v_min_downpayment numeric;
  v_downpayment numeric;
  v_mode text := lower(coalesce(p_mode, 'booking'));
  v_status text;
  v_payment_status text;
  v_hold_expires timestamptz;
  v_raw_slots jsonb;
begin
  if p_idempotency_key is not null then
    select * into v_existing
    from public.bookings
    where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object(
        'bookingReference', v_existing.ref,
        'accessToken', v_existing.guest_access_token,
        'status', v_existing.status,
        'paymentStatus', v_existing.payment_status,
        'totalAmount', v_existing.total,
        'holdExpiresAt', v_existing.hold_expires_at
      );
    end if;
  end if;

  if v_mode not in ('hold','booking') then
    raise exception 'Invalid booking mode.' using errcode = '22000';
  end if;

  perform public.expire_guest_holds();

  v_court_id := trim(coalesce(p_booking->>'courtId', p_booking->>'court_id', ''));
  if v_court_id = '' then
    raise exception 'Please select a court.' using errcode = '22000';
  end if;

  begin
    v_date := coalesce(p_booking->>'date', '')::date;
  exception when others then
    raise exception 'Please select a valid booking date.' using errcode = '22000';
  end;
  if v_date < (now() at time zone 'Asia/Manila')::date then
    raise exception 'Past dates cannot be booked.' using errcode = '22000';
  end if;

  select name into v_court_name
  from public.courts
  where id = v_court_id and not blocked;
  if not found then
    raise exception 'The selected court is not available.' using errcode = '22000';
  end if;
  if exists(select 1 from public.blocked_dates where date = v_date) then
    raise exception 'The selected date is not available.' using errcode = '22000';
  end if;

  v_raw_slots := p_booking->'slots';
  if v_raw_slots is null or jsonb_typeof(v_raw_slots) <> 'array'
     or jsonb_array_length(v_raw_slots) = 0 then
    raise exception 'Please select at least one time slot.' using errcode = '22000';
  end if;
  if exists(
    select 1 from jsonb_array_elements_text(v_raw_slots) value
    where trim(value) !~ '^([0-9]|1[0-9]|2[0-3])$'
  ) then
    raise exception 'Booking contains an invalid time slot.' using errcode = '22000';
  end if;
  select array_agg(hour_value::text order by hour_value)
    into v_slots
  from (
    select distinct trim(value)::integer as hour_value
    from jsonb_array_elements_text(v_raw_slots) value
  ) parsed;
  if cardinality(v_slots) <> jsonb_array_length(v_raw_slots) then
    raise exception 'Booking contains duplicate time slots.' using errcode = '22000';
  end if;

  select coalesce(
    (select value::integer from public.settings
      where key in ('open_hour','open_time')
      order by case key when 'open_hour' then 1 else 2 end limit 1), 6
  ) into v_open;
  select coalesce(
    (select value::integer from public.settings
      where key in ('close_hour','close_time')
      order by case key when 'close_hour' then 1 else 2 end limit 1), 24
  ) into v_close;
  if exists(
    select 1 from unnest(v_slots) slot
    where slot::integer < v_open or slot::integer >= v_close
  ) then
    raise exception 'One or more selected hours are outside operating hours.'
      using errcode = '22000';
  end if;
  if v_date = (now() at time zone 'Asia/Manila')::date
     and exists(
       select 1 from unnest(v_slots) slot
       where slot::integer <= extract(hour from (now() at time zone 'Asia/Manila'))::integer
     ) then
    raise exception 'One or more selected hours have already started.'
      using errcode = '22000';
  end if;

  v_court_total := public.calculate_booking_court_total(v_court_id, v_slots);
  v_service_fee := public.calculate_booking_service_fee(v_slots);
  v_total := round(v_court_total + v_service_fee, 2);

  v_ref := upper(trim(coalesce(p_booking->>'ref', '')));
  if v_ref !~ '^[A-Z0-9-]{6,64}$' then
    v_ref := 'DF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  end if;
  v_group_ref := nullif(trim(coalesce(p_booking->>'groupRef', '')), '');
  if v_group_ref is not null and v_group_ref !~ '^[A-Za-z0-9-]{6,80}$' then
    v_group_ref := null;
  end if;

  if v_mode = 'hold' then
    v_full_name := 'Reserving...';
    v_phone := null;
    v_email := null;
    v_method := 'cash';
    v_payment_ref := null;
    v_downpayment := null;
    v_status := 'verifying';
    v_payment_status := 'for_verification';
    v_hold_expires := now() + interval '15 minutes';
  else
    v_full_name := trim(coalesce(p_booking->>'fullName', ''));
    v_phone := regexp_replace(trim(coalesce(p_booking->>'contactNumber', '')), '[[:space:]-]', '', 'g');
    v_email := lower(trim(coalesce(p_booking->>'email', '')));
    if length(v_full_name) < 2 or length(v_full_name) > 120 then
      raise exception 'Please enter your full name.' using errcode = '22000';
    end if;
    if v_phone !~ '^(09[0-9]{9}|[+]639[0-9]{9})$' then
      raise exception 'Please enter a valid Philippine contact number.' using errcode = '22000';
    end if;
    if v_email <> '' and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      raise exception 'Please enter a valid email address.' using errcode = '22000';
    end if;
    v_email := nullif(v_email, '');

    v_method := lower(trim(coalesce(p_booking->>'paymentMethod', 'cash')));
    if not public.payment_method_is_enabled(v_method) then
      raise exception 'The selected payment method is not available.'
        using errcode = '22000';
    end if;
    v_payment_ref := nullif(trim(coalesce(p_booking->>'gcashRef', '')), '');
    if v_method = 'gcash' and coalesce(v_payment_ref, '') !~ '^[0-9]{13}$' then
      raise exception 'GCash reference number must be exactly 13 digits.'
        using errcode = '22000';
    elsif v_method = 'bdopay' and coalesce(v_payment_ref, '') !~ '^BN-[0-9]{8}-[0-9]{8}$' then
      raise exception 'The BDO Pay reference is invalid.' using errcode = '22000';
    elsif v_method = 'bpi' and coalesce(v_payment_ref, '') !~ '^[A-Za-z0-9 -]{6,40}$' then
      raise exception 'The BPI confirmation number is invalid.' using errcode = '22000';
    elsif v_method in ('maya','gotyme','pnb')
      and (v_payment_ref is null or length(v_payment_ref) < 6 or length(v_payment_ref) > 64) then
      raise exception 'The payment reference is invalid.' using errcode = '22000';
    end if;

    if v_method = 'cash' then
      v_downpayment := null;
      v_status := 'pending';
      v_payment_status := 'unpaid';
    else
      v_min_downpayment := round(v_service_fee + (v_court_total * 0.5), 2);
      if trim(coalesce(p_booking->>'downpayment', '')) ~ '^[0-9]+([.][0-9]{1,2})?$' then
        v_requested_downpayment := (p_booking->>'downpayment')::numeric;
      else
        v_requested_downpayment := v_min_downpayment;
      end if;
      if abs(v_requested_downpayment - v_total) <= 0.01 then
        v_downpayment := v_total;
      elsif abs(v_requested_downpayment - v_min_downpayment) <= 0.01 then
        v_downpayment := v_min_downpayment;
      else
        raise exception 'The payment amount does not match the server total.'
          using errcode = '22000';
      end if;
      v_status := 'pending';
      v_payment_status := 'for_verification';
    end if;
    v_hold_expires := null;
  end if;

  begin
    insert into public.bookings(
      ref, booking_group_ref, full_name, contact_number, email,
      court_id, court_name, date, slots, start_time, end_time,
      duration, rate, total, payment_method, received_account,
      payment_flow, payment_status, gcash_ref, downpayment,
      status, created_via, guest_access_token, idempotency_key,
      hold_expires_at, created_at
    )
    select
      v_ref, v_group_ref, v_full_name, v_phone, v_email,
      v_court_id, v_court_name, v_date, v_slots,
      coalesce(nullif(p_booking->>'startTime',''), min_slot::text),
      coalesce(nullif(p_booking->>'endTime',''), (max_slot + 1)::text),
      cardinality(v_slots), round(v_court_total / cardinality(v_slots), 2),
      v_total, v_method, case when v_method = 'cash' then 'cash' else v_method end,
      v_method, v_payment_status, v_payment_ref, v_downpayment,
      v_status, 'customer', v_access, p_idempotency_key,
      v_hold_expires, now()
    from (
      select min(slot::integer) as min_slot, max(slot::integer) as max_slot
      from unnest(v_slots) slot
    ) bounds
    returning * into v_booking;
  exception
    when unique_violation then
      if p_idempotency_key is not null then
        select * into v_existing
        from public.bookings
        where idempotency_key = p_idempotency_key;
        if found then
          return jsonb_build_object(
            'bookingReference', v_existing.ref,
            'accessToken', v_existing.guest_access_token,
            'status', v_existing.status,
            'paymentStatus', v_existing.payment_status,
            'totalAmount', v_existing.total,
            'holdExpiresAt', v_existing.hold_expires_at
          );
        end if;
      end if;
      raise exception 'One or more time slots are already booked and no longer available.'
        using errcode = '23505';
  end;

  return jsonb_build_object(
    'bookingReference', v_booking.ref,
    'accessToken', v_booking.guest_access_token,
    'status', v_booking.status,
    'paymentStatus', v_booking.payment_status,
    'totalAmount', v_booking.total,
    'holdExpiresAt', v_booking.hold_expires_at
  );
end;
$$;

revoke all on function public.create_guest_booking(jsonb, uuid, text) from public;
grant execute on function public.create_guest_booking(jsonb, uuid, text) to anon, authenticated;

create or replace function public.get_guest_booking_status(
  p_booking_ref text,
  p_access_token uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
begin
  select * into v_booking
  from public.bookings
  where ref = p_booking_ref
    and guest_access_token = p_access_token;
  if not found then return null; end if;

  return jsonb_build_object(
    'bookingReference', v_booking.ref,
    'courtId', v_booking.court_id,
    'courtName', v_booking.court_name,
    'date', v_booking.date,
    'slots', to_jsonb(v_booking.slots),
    'totalAmount', v_booking.total,
    'paymentMethod', v_booking.payment_method,
    'paymentStatus', v_booking.payment_status,
    'status', v_booking.status,
    'createdAt', v_booking.created_at,
    'holdExpiresAt', v_booking.hold_expires_at
  );
end;
$$;

revoke all on function public.get_guest_booking_status(text, uuid) from public;
grant execute on function public.get_guest_booking_status(text, uuid) to anon, authenticated;

create or replace function public.update_guest_booking(
  p_booking_ref text,
  p_access_token uuid,
  p_updates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
  v_method text;
  v_name text;
  v_phone text;
  v_email text;
  v_ref text;
  v_court_total numeric;
  v_service_fee numeric;
  v_min numeric;
  v_requested numeric;
  v_downpayment numeric;
begin
  select * into v_booking
  from public.bookings
  where ref = p_booking_ref
    and guest_access_token = p_access_token
  for update;
  if not found then
    raise exception 'Booking access was not found.' using errcode = '42501';
  end if;

  if v_booking.status = 'verifying'
     and v_booking.hold_expires_at is not null
     and v_booking.hold_expires_at <= now() then
    update public.bookings
       set status = 'cancelled', payment_status = 'failed'
     where ref = v_booking.ref
    returning * into v_booking;
    return jsonb_build_object(
      'bookingReference', v_booking.ref,
      'status', v_booking.status,
      'paymentStatus', v_booking.payment_status,
      'expired', true
    );
  end if;

  if v_booking.status = 'verifying' and v_booking.full_name like 'Reserving%' then
    v_name := trim(coalesce(p_updates->>'fullName', ''));
    v_phone := regexp_replace(trim(coalesce(p_updates->>'contactNumber', '')), '[[:space:]-]', '', 'g');
    v_email := lower(trim(coalesce(p_updates->>'email', '')));
    if length(v_name) < 2 or length(v_name) > 120 then
      raise exception 'Please enter your full name.' using errcode = '22000';
    end if;
    if v_phone !~ '^(09[0-9]{9}|[+]639[0-9]{9})$' then
      raise exception 'Please enter a valid Philippine contact number.' using errcode = '22000';
    end if;
    if v_email <> '' and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      raise exception 'Please enter a valid email address.' using errcode = '22000';
    end if;
    v_email := nullif(v_email, '');

    v_method := lower(trim(coalesce(p_updates->>'paymentMethod', 'cash')));
    if not public.payment_method_is_enabled(v_method) then
      raise exception 'The selected payment method is not available.'
        using errcode = '22000';
    end if;
    v_ref := nullif(trim(coalesce(p_updates->>'gcashRef', '')), '');
    if v_method = 'gcash' and coalesce(v_ref, '') !~ '^[0-9]{13}$' then
      raise exception 'GCash reference number must be exactly 13 digits.'
        using errcode = '22000';
    elsif v_method = 'bdopay' and coalesce(v_ref, '') !~ '^BN-[0-9]{8}-[0-9]{8}$' then
      raise exception 'The BDO Pay reference is invalid.' using errcode = '22000';
    elsif v_method in ('maya','bpi','gotyme','pnb')
      and (v_ref is null or length(v_ref) < 6 or length(v_ref) > 64) then
      raise exception 'The payment reference is invalid.' using errcode = '22000';
    end if;

    if v_method = 'cash' then
      v_downpayment := null;
    else
      v_court_total := public.calculate_booking_court_total(v_booking.court_id, v_booking.slots);
      v_service_fee := public.calculate_booking_service_fee(v_booking.slots);
      v_min := round(v_service_fee + (v_court_total * 0.5), 2);
      if trim(coalesce(p_updates->>'downpayment', '')) ~ '^[0-9]+([.][0-9]{1,2})?$' then
        v_requested := (p_updates->>'downpayment')::numeric;
      else
        v_requested := v_min;
      end if;
      if abs(v_requested - v_booking.total) <= 0.01 then
        v_downpayment := v_booking.total;
      elsif abs(v_requested - v_min) <= 0.01 then
        v_downpayment := v_min;
      else
        raise exception 'The payment amount does not match the server total.'
          using errcode = '22000';
      end if;
    end if;

    update public.bookings
       set full_name = v_name,
           contact_number = v_phone,
           email = v_email,
           payment_method = v_method,
           received_account = case when v_method = 'cash' then 'cash' else v_method end,
           payment_flow = v_method,
           payment_status = case when v_method = 'cash' then 'unpaid' else 'for_verification' end,
           gcash_ref = v_ref,
           downpayment = v_downpayment,
           status = 'pending',
           hold_expires_at = null
     where ref = v_booking.ref
    returning * into v_booking;
  elsif lower(coalesce(p_updates->>'status', '')) in ('cancelled','expired','rejected') then
    update public.bookings
       set status = 'cancelled',
           payment_status = case
             when payment_status in ('paid','downpayment_paid') then payment_status
             else 'rejected'
           end
     where ref = v_booking.ref
    returning * into v_booking;
  elsif lower(coalesce(p_updates->>'status', '')) = 'pending'
     or lower(coalesce(p_updates->>'paymentStatus', '')) = 'for_verification' then
    update public.bookings
       set status = 'pending',
           payment_status = case
             when payment_status in ('paid','downpayment_paid') then payment_status
             else 'for_verification'
           end
     where ref = v_booking.ref
    returning * into v_booking;
  else
    raise exception 'This booking change is not allowed.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'bookingReference', v_booking.ref,
    'status', v_booking.status,
    'paymentStatus', v_booking.payment_status,
    'totalAmount', v_booking.total,
    'holdExpiresAt', v_booking.hold_expires_at
  );
end;
$$;

revoke all on function public.update_guest_booking(text, uuid, jsonb) from public;
grant execute on function public.update_guest_booking(text, uuid, jsonb) to anon, authenticated;

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
         forfeiture_reason = left(nullif(trim(coalesce(p_reason, '')), ''), 250)
   where ref = p_booking_ref
     and guest_access_token = p_access_token
  returning * into v_booking;
  if not found then
    raise exception 'Booking access was not found.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'bookingReference', v_booking.ref,
    'status', v_booking.status,
    'paymentStatus', v_booking.payment_status
  );
end;
$$;

revoke all on function public.cancel_guest_booking(text, uuid, text) from public;
grant execute on function public.cancel_guest_booking(text, uuid, text) to anon, authenticated;

create or replace function public.get_public_open_play_counts(p_date date)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with counts as (
    select court_id, count(*)::integer as count
    from public.open_play_registrations
    where date = p_date and coalesce(payment_status, 'pending') <> 'rejected'
    group by court_id
  )
  select coalesce(jsonb_object_agg(court_id, count), '{}'::jsonb)
    || jsonb_build_object('total', coalesce(sum(count), 0))
  from counts
$$;

revoke all on function public.get_public_open_play_counts(date) from public;
grant execute on function public.get_public_open_play_counts(date) to anon, authenticated;

create or replace function public.create_public_open_play_registration(
  p_registration jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.open_play_registrations%rowtype;
  v_config jsonb;
  v_enabled boolean;
  v_max integer;
  v_name text;
  v_court_id text;
  v_court_name text;
  v_date date;
  v_hour integer;
  v_method text;
  v_amount numeric;
  v_id bigint;
begin
  if p_idempotency_key is not null then
    select * into v_existing from public.open_play_registrations
    where idempotency_key = p_idempotency_key;
    if found then return jsonb_build_object('id', v_existing.id, 'created', false); end if;
  end if;

  begin
    select value::jsonb into v_config from public.settings where key = 'open_play_config';
  exception when others then
    v_config := '{}'::jsonb;
  end;
  v_enabled := coalesce((v_config->>'enabled')::boolean, false);
  v_max := greatest(1, least(200, coalesce((v_config->>'maxPlayers')::integer, 40)));
  if not v_enabled then
    raise exception 'Open Play registration is not available.' using errcode = '22000';
  end if;

  v_name := trim(coalesce(p_registration->>'fullName', ''));
  v_court_id := trim(coalesce(p_registration->>'courtId', ''));
  begin
    v_date := (p_registration->>'date')::date;
    v_hour := (p_registration->>'hour')::integer;
  exception when others then
    raise exception 'Invalid Open Play schedule.' using errcode = '22000';
  end;
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Please enter your full name.' using errcode = '22000';
  end if;
  select name into v_court_name from public.courts
  where id = v_court_id and not blocked;
  if not found or v_date < (now() at time zone 'Asia/Manila')::date
     or v_hour < 0 or v_hour > 23 then
    raise exception 'Invalid Open Play schedule.' using errcode = '22000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_court_id || '|' || v_date || '|' || v_hour, 0));
  if (
    select count(*) from public.open_play_registrations
    where court_id = v_court_id and date = v_date and hour = v_hour
      and coalesce(payment_status, 'pending') <> 'rejected'
  ) >= v_max then
    raise exception 'This Open Play session is already full.' using errcode = '22000';
  end if;

  v_method := lower(trim(coalesce(p_registration->>'paymentMethod', 'cash')));
  if not public.payment_method_is_enabled(v_method) then
    raise exception 'The selected payment method is not available.' using errcode = '22000';
  end if;
  v_amount := greatest(0, coalesce((v_config->>'fee')::numeric, 0)
    + public.calculate_booking_service_fee(array[v_hour::text]));

  insert into public.open_play_registrations(
    full_name, court_id, court_name, date, hour, time_label,
    payment_type, amount, payment_method, gcash_ref,
    payment_status, receipt_status, idempotency_key
  ) values (
    v_name, v_court_id, v_court_name, v_date, v_hour,
    left(coalesce(p_registration->>'timeLabel', ''), 120),
    case when lower(coalesce(p_registration->>'paymentType','')) in ('50%','100%')
      then p_registration->>'paymentType' else '100%' end,
    v_amount, v_method,
    case when v_method = 'cash' then null else left(nullif(trim(p_registration->>'gcashRef'), ''), 64) end,
    case when v_method = 'cash' then 'pending' else 'pending' end,
    'none', p_idempotency_key
  )
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'created', true);
exception
  when unique_violation then
    select * into v_existing from public.open_play_registrations
    where idempotency_key = p_idempotency_key;
    if found then return jsonb_build_object('id', v_existing.id, 'created', false); end if;
    raise;
end;
$$;

revoke all on function public.create_public_open_play_registration(jsonb, uuid) from public;
grant execute on function public.create_public_open_play_registration(jsonb, uuid) to anon, authenticated;

create or replace function public.get_public_open_play_host_sessions()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'hostUserId', host_user_id,
    'hostName', host_name,
    'hostEmail', '',
    'title', title,
    'date', date,
    'startHour', start_hour,
    'endHour', end_hour,
    'courtIds', to_jsonb(court_ids),
    'courtNames', to_jsonb(court_names),
    'maxPlayers', max_players,
    'feePerPlayer', fee_per_player,
    'status', status,
    'notes', '',
    'paymentInstructions', '',
    'createdAt', created_at,
    'updatedAt', updated_at
  ) order by date, start_hour), '[]'::jsonb)
  from public.open_play_host_sessions
  where status = 'published'
    and date >= (now() at time zone 'Asia/Manila')::date
$$;

revoke all on function public.get_public_open_play_host_sessions() from public;
grant execute on function public.get_public_open_play_host_sessions() to anon, authenticated;

create or replace function public.create_public_host_session_registration(
  p_registration jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.open_play_host_session_registrations%rowtype;
  v_session public.open_play_host_sessions%rowtype;
  v_session_id uuid;
  v_name text;
  v_phone text;
  v_method text;
  v_id uuid;
begin
  if p_idempotency_key is not null then
    select * into v_existing from public.open_play_host_session_registrations
    where idempotency_key = p_idempotency_key;
    if found then return jsonb_build_object('id', v_existing.id, 'created', false); end if;
  end if;
  begin
    v_session_id := (p_registration->>'sessionId')::uuid;
  exception when others then
    raise exception 'Invalid host session.' using errcode = '22000';
  end;
  select * into v_session from public.open_play_host_sessions
  where id = v_session_id and status = 'published'
  for update;
  if not found or v_session.date < (now() at time zone 'Asia/Manila')::date then
    raise exception 'This host session is not available.' using errcode = '22000';
  end if;
  if public.count_open_play_host_session_registrations(v_session_id) >= v_session.max_players then
    raise exception 'This host session is already full.' using errcode = '22000';
  end if;
  v_name := trim(coalesce(p_registration->>'fullName', ''));
  v_phone := regexp_replace(trim(coalesce(p_registration->>'contactNumber', '')), '[[:space:]-]', '', 'g');
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Please enter your full name.' using errcode = '22000';
  end if;
  if v_phone <> '' and v_phone !~ '^(09[0-9]{9}|[+]639[0-9]{9})$' then
    raise exception 'Please enter a valid Philippine contact number.' using errcode = '22000';
  end if;
  v_method := case when v_session.fee_per_player <= 0 then 'cash'
    else lower(trim(coalesce(p_registration->>'paymentMethod', ''))) end;
  if v_session.fee_per_player > 0 and not public.payment_method_is_enabled(v_method) then
    raise exception 'The selected payment method is not available.' using errcode = '22000';
  end if;

  insert into public.open_play_host_session_registrations(
    session_id, full_name, contact_number, payment_method, gcash_ref,
    payment_status, amount, receipt_status, idempotency_key
  ) values (
    v_session_id, v_name, nullif(v_phone, ''), v_method,
    case when v_method = 'cash' then null else left(nullif(trim(p_registration->>'gcashRef'), ''), 64) end,
    case when v_session.fee_per_player <= 0 then 'paid' else 'pending' end,
    v_session.fee_per_player, 'none', p_idempotency_key
  )
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'created', true);
exception
  when unique_violation then
    select * into v_existing from public.open_play_host_session_registrations
    where idempotency_key = p_idempotency_key;
    if found then return jsonb_build_object('id', v_existing.id, 'created', false); end if;
    raise;
end;
$$;

revoke all on function public.create_public_host_session_registration(jsonb, uuid) from public;
grant execute on function public.create_public_host_session_registration(jsonb, uuid) to anon, authenticated;

create or replace function public.create_public_host_application(p_application jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_name text := trim(coalesce(p_application->>'fullName', ''));
  v_phone text := regexp_replace(trim(coalesce(p_application->>'contactNumber', '')), '[[:space:]-]', '', 'g');
  v_email text := lower(trim(coalesce(p_application->>'email', '')));
begin
  if length(v_name) < 2 or length(v_name) > 120
     or v_phone !~ '^(09[0-9]{9}|[+]639[0-9]{9})$'
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Please enter valid host application details.' using errcode = '22000';
  end if;
  if exists(
    select 1 from public.open_play_host_applications
    where lower(email) = v_email and status = 'pending'
  ) then
    raise exception 'A host application for this email is already pending.'
      using errcode = '22000';
  end if;
  insert into public.open_play_host_applications(
    full_name, contact_number, email, preferred_schedule, notes, status
  ) values (
    v_name, v_phone, v_email,
    left(nullif(trim(p_application->>'preferredSchedule'), ''), 250),
    left(nullif(trim(p_application->>'notes'), ''), 1000),
    'pending'
  )
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'pending');
end;
$$;

revoke all on function public.create_public_host_application(jsonb) from public;
grant execute on function public.create_public_host_application(jsonb) to anon, authenticated;

-- Anonymous users have no direct access to booking or registration PII.
drop policy if exists bookings_select_public on public.bookings;
drop policy if exists bookings_insert_public on public.bookings;
drop policy if exists bookings_update_public_hold on public.bookings;
drop policy if exists open_play_select_public on public.open_play_registrations;
drop policy if exists open_play_insert_public on public.open_play_registrations;
drop policy if exists open_play_host_applications_insert_public on public.open_play_host_applications;
drop policy if exists open_play_host_session_registrations_insert_public
  on public.open_play_host_session_registrations;
drop policy if exists open_play_host_sessions_select_public on public.open_play_host_sessions;
drop policy if exists settings_select_public on public.settings;
drop policy if exists receipt_verifications_select_admin on public.receipt_verifications;

drop policy if exists settings_select_dashboard_roles on public.settings;
create policy settings_select_dashboard_roles on public.settings
  for select to authenticated
  using (public.has_account_role(array['owner','court_owner','staff','host']));

drop policy if exists bookings_select_dashboard_roles on public.bookings;
create policy bookings_select_dashboard_roles on public.bookings
  for select to authenticated
  using (
    public.has_account_role(array['owner','court_owner','staff'])
    or (
      public.has_account_role(array['host'])
      and host_user_id = auth.uid()
    )
  );

drop policy if exists open_play_host_sessions_select_authenticated
  on public.open_play_host_sessions;
create policy open_play_host_sessions_select_authenticated
  on public.open_play_host_sessions
  for select to authenticated
  using (
    public.has_account_role(array['owner','court_owner','staff'])
    or (public.has_account_role(array['host']) and host_user_id = auth.uid())
  );

drop policy if exists receipt_verifications_select_dashboard_roles
  on public.receipt_verifications;
create policy receipt_verifications_select_dashboard_roles
  on public.receipt_verifications
  for select to authenticated
  using (public.has_account_role(array['owner','court_owner','staff']));

drop policy if exists receipts_no_select on storage.objects;
drop policy if exists receipts_no_insert on storage.objects;
drop policy if exists receipts_no_update on storage.objects;
drop policy if exists receipts_no_delete on storage.objects;

revoke all on public.bookings from anon;
revoke all on public.booking_slots from anon, authenticated;
revoke all on public.open_play_registrations from anon;
revoke all on public.open_play_host_applications from anon;
revoke all on public.open_play_host_sessions from anon;
revoke all on public.open_play_host_session_registrations from anon;
revoke all on public.receipt_verifications from anon;
revoke all on public.settings from anon;

grant select on public.courts, public.blocked_dates to anon;
grant select on public.courts, public.blocked_dates, public.settings to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- HISTORICAL ONE-TIME FRESH-INSTALL NORMALIZATION.
-- Never replay this section on the live project. Admin-saved court and setting
-- values are authoritative after initial installation.
-- Replace the generic starter records with the real D'fortees venue only.
delete from public.courts
where id in ('c1','c2')
  and name in ('Court Alpha','Court Beta');

insert into public.courts(
  id, name, description, rate, blocked, feats, photo, rate_schedule
)
values (
  'c1',
  'D''fortees Pickleball Court',
  'Outdoor pickleball court',
  60,
  false,
  array['Outdoor'],
  null,
  '[{"from":6,"to":18,"rate":60},{"from":18,"to":24,"rate":90}]'::jsonb
)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  rate = excluded.rate,
  blocked = excluded.blocked,
  feats = excluded.feats,
  rate_schedule = excluded.rate_schedule;

insert into public.settings(key, value)
values
  ('venue_name', 'D''fortees Pickleball Court'),
  ('venue_address', 'Prk-4 National Highway, 8801 Montevista'),
  ('venue_phone', '09232579854'),
  ('venue_facebook', 'https://www.facebook.com/Dfortees'),
  ('open_hour', '6'),
  ('close_hour', '24'),
  ('pricing_tiers', '[{"from":6,"to":18,"rate":60},{"from":18,"to":24,"rate":90}]'),
  ('maintenance_fee', '5'),
  ('service_fee_rate', '5'),
  ('booking_fee', '5'),
  ('fee_type', 'per_hour'),
  ('maintenance_config', '{"enabled":true,"label":"Booking Fee","amount":5,"type":"per_hour"}'),
  ('open_play_config', '{"enabled":false,"start":17,"end":24,"days":[],"specificDates":[],"courtIds":["c1"],"fee":100,"maxPlayers":40}'),
  ('payment_acceptance_mode', 'both'),
  ('payment_method_cash', '1'),
  ('payment_method_gcash', '0'),
  ('payment_method_bdopay', '0'),
  ('payment_method_maya', '0'),
  ('payment_method_bpi', '0'),
  ('payment_method_gotyme', '0'),
  ('payment_method_pnb', '0'),
  ('gcash_checkout_enabled', '0')
on conflict (key) do update set
  value = excluded.value,
  updated_at = now();

-- Host balance automation stays off until its hardened Edge Function and
-- HOST_BALANCE_CRON_SECRET are explicitly configured.
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'process-host-balance-deadlines'
  limit 1;
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end;
$$;

notify pgrst, 'reload schema';
