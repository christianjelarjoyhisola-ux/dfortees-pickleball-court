-- Court Booking Platform: clean multi-tenant baseline
-- Apply only to a new, empty Supabase project.
-- The legacy single-tenant migrations in /supabase/migrations are not part of
-- this platform and must never be applied to this project.

begin;

create type public.tenant_status as enum ('active', 'suspended', 'archived');
create type public.membership_role as enum ('owner', 'staff', 'host');
create type public.membership_status as enum ('invited', 'active', 'disabled');
create type public.booking_status as enum (
  'pending', 'confirmed', 'cancelled', 'expired', 'completed', 'voided'
);
create type public.payment_status as enum (
  'unpaid', 'pending', 'paid', 'rejected', 'refunded', 'voided'
);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug = lower(slug) and slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null check (length(btrim(name)) between 2 and 120),
  status public.tenant_status not null default 'active',
  timezone text not null default 'Asia/Manila',
  address text,
  locality text,
  phone text,
  facebook_url text,
  logo_path text,
  tagline text,
  primary_color text not null default '#086b3a' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text not null default '#f7dc42' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  currency text not null default 'PHP' check (currency ~ '^[A-Z]{3}$'),
  booking_settings jsonb not null default '{}'::jsonb check (jsonb_typeof(booking_settings) = 'object'),
  payment_settings jsonb not null default '{}'::jsonb check (jsonb_typeof(payment_settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, slug)
);

create table public.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  hostname text not null check (hostname = lower(hostname) and hostname !~ '[/:]'),
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (hostname),
  foreign key (tenant_id) references public.tenants(id) on delete cascade
);

create unique index tenant_domains_one_primary_per_tenant
  on public.tenant_domains (tenant_id) where is_primary;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.platform_admin_allowlist (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.tenant_memberships (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.membership_role not null,
  status public.membership_status not null default 'invited',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table public.courts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  slug text not null check (slug = lower(slug) and slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null check (length(btrim(name)) between 2 and 100),
  description text,
  environment text not null default 'Outdoor' check (environment in ('Indoor', 'Outdoor', 'Covered')),
  open_hour smallint not null default 6 check (open_hour between 0 and 23),
  close_hour smallint not null default 24 check (close_hour between 1 and 24),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (close_hour > open_hour),
  unique (tenant_id, id),
  unique (tenant_id, slug),
  foreign key (tenant_id) references public.tenants(id) on delete cascade
);

create table public.court_rate_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  court_id uuid not null,
  label text not null,
  start_hour smallint not null check (start_hour between 0 and 23),
  end_hour smallint not null check (end_hour between 1 and 24),
  rate_php numeric(10,2) not null check (rate_php >= 0),
  days_of_week smallint[] not null default array[0,1,2,3,4,5,6]::smallint[],
  effective_from date,
  effective_until date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_hour > start_hour),
  check (days_of_week <@ array[0,1,2,3,4,5,6]::smallint[] and cardinality(days_of_week) > 0),
  check (effective_until is null or effective_from is null or effective_until >= effective_from),
  unique (tenant_id, id),
  foreign key (tenant_id, court_id) references public.courts(tenant_id, id) on delete cascade
);

create table public.tenant_settings (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_.-]{1,80}$'),
  value jsonb not null,
  is_public boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

create table public.blocked_dates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  court_id uuid,
  blocked_date date not null,
  start_hour smallint check (start_hour between 0 and 23),
  end_hour smallint check (end_hour between 1 and 24),
  reason text,
  created_at timestamptz not null default now(),
  check ((start_hour is null and end_hour is null) or
         (start_hour is not null and end_hour is not null and end_hour > start_hour)),
  unique (tenant_id, id),
  foreign key (tenant_id) references public.tenants(id) on delete cascade,
  foreign key (tenant_id, court_id) references public.courts(tenant_id, id) on delete cascade
);

create unique index blocked_dates_unique_court_block
  on public.blocked_dates (tenant_id, court_id, blocked_date, coalesce(start_hour, -1), coalesce(end_hour, -1));
create unique index blocked_dates_unique_tenant_block
  on public.blocked_dates (tenant_id, blocked_date, coalesce(start_hour, -1), coalesce(end_hour, -1))
  where court_id is null;

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  court_id uuid not null,
  booking_reference text not null,
  guest_access_token uuid not null default gen_random_uuid(),
  idempotency_key uuid not null,
  booking_date date not null,
  slots smallint[] not null,
  customer_name text not null check (length(btrim(customer_name)) between 2 and 120),
  customer_phone text not null check (length(btrim(customer_phone)) between 7 and 30),
  customer_email text,
  customer_notes text,
  status public.booking_status not null default 'pending',
  payment_status public.payment_status not null default 'unpaid',
  currency text not null default 'PHP' check (currency ~ '^[A-Z]{3}$'),
  total_amount numeric(10,2) not null check (total_amount >= 0),
  hold_expires_at timestamptz,
  source text not null default 'web' check (source in ('web', 'admin', 'host', 'import')),
  created_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(slots) > 0 and slots <@ array[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]::smallint[]),
  unique (tenant_id, id),
  unique (tenant_id, booking_reference),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, court_id) references public.courts(tenant_id, id) on delete restrict
);

create table public.booking_slots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid not null,
  court_id uuid not null,
  booking_date date not null,
  start_hour smallint not null check (start_hour between 0 and 23),
  released_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, booking_id, start_hour),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade,
  foreign key (tenant_id, court_id) references public.courts(tenant_id, id) on delete restrict
);

create unique index booking_slots_one_active_reservation
  on public.booking_slots (tenant_id, court_id, booking_date, start_hour)
  where released_at is null;

create table public.open_play_hosts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id) references public.tenants(id) on delete cascade
);

create table public.open_play_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  court_id uuid not null,
  host_id uuid,
  session_date date not null,
  start_hour smallint not null check (start_hour between 0 and 23),
  end_hour smallint not null check (end_hour between 1 and 24),
  capacity integer not null check (capacity > 0),
  fee_per_player numeric(10,2) not null default 0 check (fee_per_player >= 0),
  status text not null default 'scheduled' check (status in ('draft', 'scheduled', 'cancelled', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_hour > start_hour),
  unique (tenant_id, id),
  foreign key (tenant_id, court_id) references public.courts(tenant_id, id) on delete restrict,
  foreign key (tenant_id, host_id) references public.open_play_hosts(tenant_id, id) on delete restrict
);

create table public.open_play_registrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  session_id uuid not null,
  guest_access_token uuid not null default gen_random_uuid(),
  idempotency_key uuid not null,
  player_name text not null,
  player_phone text not null,
  player_email text,
  party_size integer not null default 1 check (party_size > 0),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'waitlisted')),
  payment_status public.payment_status not null default 'unpaid',
  total_amount numeric(10,2) not null check (total_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, session_id) references public.open_play_sessions(tenant_id, id) on delete cascade
);

create table public.payment_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid,
  registration_id uuid,
  provider text not null,
  provider_reference text,
  amount numeric(10,2) not null check (amount >= 0),
  currency text not null default 'PHP',
  status text not null default 'created' check (status in ('created', 'pending', 'paid', 'failed', 'expired', 'cancelled')),
  signed_context jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(booking_id, registration_id) = 1),
  unique (tenant_id, id),
  unique (tenant_id, provider, provider_reference),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade,
  foreign key (tenant_id, registration_id) references public.open_play_registrations(tenant_id, id) on delete cascade
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid,
  registration_id uuid,
  payment_session_id uuid,
  method text not null,
  provider_reference text,
  amount numeric(10,2) not null check (amount >= 0),
  currency text not null default 'PHP',
  status public.payment_status not null default 'pending',
  received_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(booking_id, registration_id) = 1),
  unique (tenant_id, id),
  unique (tenant_id, method, provider_reference),
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade,
  foreign key (tenant_id, registration_id) references public.open_play_registrations(tenant_id, id) on delete cascade,
  foreign key (tenant_id, payment_session_id) references public.payment_sessions(tenant_id, id) on delete restrict
);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  payment_id uuid not null,
  storage_bucket text not null default 'tenant-receipts',
  storage_path text not null,
  mime_type text,
  file_size bigint check (file_size is null or file_size > 0),
  review_status text not null default 'pending' check (review_status in ('pending', 'accepted', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, storage_path),
  foreign key (tenant_id, payment_id) references public.payments(tenant_id, id) on delete cascade
);

create table public.remittances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  period_start date not null,
  period_end date not null,
  amount numeric(10,2) not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'submitted', 'verified', 'rejected', 'voided')),
  storage_path text,
  submitted_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique (tenant_id, id),
  foreign key (tenant_id) references public.tenants(id) on delete cascade
);

create table public.agreements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  agreement_type text not null,
  version text not null,
  accepted_at timestamptz not null default now(),
  acceptance_ip_hash text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, user_id, agreement_type, version),
  foreign key (tenant_id, user_id) references public.tenant_memberships(tenant_id, user_id) on delete cascade
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  booking_id uuid,
  recipient text not null,
  channel text not null check (channel in ('email', 'sms', 'telegram', 'in_app')),
  template_key text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'cancelled')),
  payload jsonb not null default '{}'::jsonb,
  provider_reference text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id) references public.tenants(id) on delete cascade,
  foreign key (tenant_id, booking_id) references public.bookings(tenant_id, id) on delete cascade
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now(),
  foreign key (tenant_id) references public.tenants(id) on delete cascade
);

create index bookings_tenant_date_idx on public.bookings (tenant_id, booking_date, status);
create index bookings_tenant_customer_phone_idx on public.bookings (tenant_id, customer_phone);
create index booking_slots_availability_idx on public.booking_slots (tenant_id, court_id, booking_date, start_hour) where released_at is null;
create index rate_rules_lookup_idx on public.court_rate_rules (tenant_id, court_id, is_active, start_hour, end_hour);
create index open_play_sessions_tenant_date_idx on public.open_play_sessions (tenant_id, session_date, status);
create index audit_logs_tenant_created_idx on public.audit_logs (tenant_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and exists (
       select 1 from public.platform_admins pa where pa.user_id = auth.uid()
     );
$$;

create or replace function public.has_tenant_role(
  p_tenant_id uuid,
  p_roles public.membership_role[] default array['owner','staff']::public.membership_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and exists (
       select 1
       from public.tenant_memberships tm
       where tm.tenant_id = p_tenant_id
         and tm.user_id = auth.uid()
         and tm.status = 'active'
         and tm.role = any(p_roles)
     );
$$;

create or replace function public.storage_tenant_id(p_path text)
returns uuid
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_first text;
begin
  v_first := split_part(p_path, '/', 1);
  if v_first ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return v_first::uuid;
  end if;
  return null;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;

  if new.email is not null and exists (
    select 1 from public.platform_admin_allowlist a where a.email = lower(new.email)
  ) then
    insert into public.platform_admins (user_id) values (new.id)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create trigger tenants_set_updated_at before update on public.tenants
  for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger memberships_set_updated_at before update on public.tenant_memberships
  for each row execute function public.set_updated_at();
create trigger courts_set_updated_at before update on public.courts
  for each row execute function public.set_updated_at();
create trigger rates_set_updated_at before update on public.court_rate_rules
  for each row execute function public.set_updated_at();
create trigger bookings_set_updated_at before update on public.bookings
  for each row execute function public.set_updated_at();
create trigger open_play_hosts_set_updated_at before update on public.open_play_hosts
  for each row execute function public.set_updated_at();
create trigger open_play_sessions_set_updated_at before update on public.open_play_sessions
  for each row execute function public.set_updated_at();
create trigger open_play_registrations_set_updated_at before update on public.open_play_registrations
  for each row execute function public.set_updated_at();
create trigger payment_sessions_set_updated_at before update on public.payment_sessions
  for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();
create trigger remittances_set_updated_at before update on public.remittances
  for each row execute function public.set_updated_at();

create or replace function public.release_inactive_booking_slots()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('cancelled', 'expired', 'voided')
     and old.status is distinct from new.status then
    update public.booking_slots
       set released_at = coalesce(released_at, now())
     where tenant_id = new.tenant_id
       and booking_id = new.id
       and released_at is null;
  end if;
  return new;
end;
$$;

create trigger bookings_release_inactive_slots
  after update of status on public.bookings
  for each row execute function public.release_inactive_booking_slots();

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
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger courts_audit after insert or update or delete on public.courts
  for each row execute function public.write_tenant_audit_log();
create trigger rates_audit after insert or update or delete on public.court_rate_rules
  for each row execute function public.write_tenant_audit_log();
create trigger bookings_audit after insert or update or delete on public.bookings
  for each row execute function public.write_tenant_audit_log();
create trigger payments_audit after insert or update or delete on public.payments
  for each row execute function public.write_tenant_audit_log();
create trigger settings_audit after insert or update or delete on public.tenant_settings
  for each row execute function public.write_tenant_audit_log();

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
        'closeHour', c.close_hour
      ) order by c.sort_order, c.name)
      from public.courts c
      where c.tenant_id = t.id and c.is_active
    ), '[]'::jsonb)
  )
  from public.tenants t
  where t.slug = lower(btrim(p_tenant_slug))
    and t.status = 'active';
$$;

create or replace function public.get_public_availability(
  p_tenant_slug text,
  p_booking_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant public.tenants%rowtype;
  v_result jsonb;
begin
  select * into v_tenant
  from public.tenants
  where slug = lower(btrim(p_tenant_slug)) and status = 'active';

  if not found then
    raise exception using errcode = 'P0001', message = 'Venue not found.';
  end if;
  if p_booking_date < (now() at time zone v_tenant.timezone)::date then
    raise exception using errcode = 'P0001', message = 'Booking date cannot be in the past.';
  end if;

  select jsonb_build_object(
    'tenantSlug', v_tenant.slug,
    'date', p_booking_date,
    'timezone', v_tenant.timezone,
    'courts', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'environment', c.environment,
        'slots', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'startHour', h,
              'endHour', h + 1,
              'price', (
                select rr.rate_php
                from public.court_rate_rules rr
                where rr.tenant_id = c.tenant_id
                  and rr.court_id = c.id
                  and rr.is_active
                  and h >= rr.start_hour and h < rr.end_hour
                  and extract(dow from p_booking_date)::smallint = any(rr.days_of_week)
                  and (rr.effective_from is null or rr.effective_from <= p_booking_date)
                  and (rr.effective_until is null or rr.effective_until >= p_booking_date)
                order by rr.effective_from desc nulls last, rr.created_at desc
                limit 1
              ),
              'available',
                not exists (
                  select 1
                  from public.blocked_dates bd
                  where bd.tenant_id = c.tenant_id
                    and (bd.court_id is null or bd.court_id = c.id)
                    and bd.blocked_date = p_booking_date
                    and (bd.start_hour is null or (h >= bd.start_hour and h < bd.end_hour))
                )
                and not exists (
                  select 1
                  from public.booking_slots bs
                  join public.bookings b
                    on b.tenant_id = bs.tenant_id and b.id = bs.booking_id
                  where bs.tenant_id = c.tenant_id
                    and bs.court_id = c.id
                    and bs.booking_date = p_booking_date
                    and bs.start_hour = h
                    and bs.released_at is null
                    and b.status in ('pending', 'confirmed', 'completed')
                    and (b.status <> 'pending' or b.hold_expires_at is null or b.hold_expires_at > now())
                )
                and not (
                  p_booking_date = (now() at time zone v_tenant.timezone)::date
                  and h <= extract(hour from now() at time zone v_tenant.timezone)::smallint
                )
            ) order by h
          )
          from generate_series(c.open_hour, c.close_hour - 1) h
        ), '[]'::jsonb)
      ) order by c.sort_order, c.name
    ), '[]'::jsonb)
  ) into v_result
  from public.courts c
  where c.tenant_id = v_tenant.id and c.is_active;

  return v_result;
end;
$$;

create or replace function public.create_guest_booking(
  p_tenant_slug text,
  p_court_id uuid,
  p_booking_date date,
  p_slots integer[],
  p_customer_details jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant public.tenants%rowtype;
  v_court public.courts%rowtype;
  v_booking public.bookings%rowtype;
  v_slots smallint[];
  v_slot integer;
  v_total numeric(10,2) := 0;
  v_rate numeric(10,2);
  v_reference text;
  v_hold_minutes integer;
  v_local_now timestamp;
begin
  if p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'An idempotency key is required.';
  end if;
  if p_customer_details is null or jsonb_typeof(p_customer_details) <> 'object' then
    raise exception using errcode = 'P0001', message = 'Customer details are required.';
  end if;

  select * into v_tenant
  from public.tenants
  where slug = lower(btrim(p_tenant_slug)) and status = 'active';
  if not found then
    raise exception using errcode = 'P0001', message = 'Venue not found.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_tenant.id::text || ':' || p_idempotency_key::text, 0));

  select * into v_booking
  from public.bookings
  where tenant_id = v_tenant.id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'bookingReference', v_booking.booking_reference,
      'accessToken', v_booking.guest_access_token,
      'status', v_booking.status,
      'paymentStatus', v_booking.payment_status,
      'totalAmount', v_booking.total_amount,
      'currency', v_booking.currency,
      'idempotentReplay', true
    );
  end if;

  select * into v_court
  from public.courts
  where tenant_id = v_tenant.id and id = p_court_id and is_active;
  if not found then
    raise exception using errcode = 'P0001', message = 'Court not found.';
  end if;

  select array_agg(distinct s order by s)::smallint[] into v_slots
  from unnest(p_slots) s;
  if v_slots is null or cardinality(v_slots) = 0 then
    raise exception using errcode = 'P0001', message = 'Select at least one time.';
  end if;
  if cardinality(v_slots) <> cardinality(p_slots) then
    raise exception using errcode = 'P0001', message = 'Duplicate time slots are not allowed.';
  end if;
  if exists (select 1 from unnest(v_slots) s where s < v_court.open_hour or s >= v_court.close_hour) then
    raise exception using errcode = 'P0001', message = 'A selected time is outside court hours.';
  end if;

  v_local_now := now() at time zone v_tenant.timezone;
  if p_booking_date < v_local_now::date then
    raise exception using errcode = 'P0001', message = 'Booking date cannot be in the past.';
  end if;
  if p_booking_date = v_local_now::date
     and exists (select 1 from unnest(v_slots) s where s <= extract(hour from v_local_now)::integer) then
    raise exception using errcode = 'P0001', message = 'A selected time has already passed.';
  end if;
  if exists (
    select 1 from public.blocked_dates bd
    join unnest(v_slots) s on bd.start_hour is null or (s >= bd.start_hour and s < bd.end_hour)
    where bd.tenant_id = v_tenant.id
      and (bd.court_id is null or bd.court_id = v_court.id)
      and bd.blocked_date = p_booking_date
  ) then
    raise exception using errcode = 'P0001', message = 'A selected time is unavailable.';
  end if;

  update public.bookings
     set status = 'expired'
   where tenant_id = v_tenant.id
     and status = 'pending'
     and hold_expires_at is not null
     and hold_expires_at <= now();

  foreach v_slot in array v_slots loop
    select rr.rate_php into v_rate
    from public.court_rate_rules rr
    where rr.tenant_id = v_tenant.id
      and rr.court_id = v_court.id
      and rr.is_active
      and v_slot >= rr.start_hour and v_slot < rr.end_hour
      and extract(dow from p_booking_date)::smallint = any(rr.days_of_week)
      and (rr.effective_from is null or rr.effective_from <= p_booking_date)
      and (rr.effective_until is null or rr.effective_until >= p_booking_date)
    order by rr.effective_from desc nulls last, rr.created_at desc
    limit 1;
    if v_rate is null then
      raise exception using errcode = 'P0001', message = 'Pricing is not configured for a selected time.';
    end if;
    v_total := v_total + v_rate;
  end loop;

  if length(btrim(coalesce(p_customer_details ->> 'fullName', ''))) < 2 then
    raise exception using errcode = 'P0001', message = 'Customer name is required.';
  end if;
  if length(btrim(coalesce(p_customer_details ->> 'phone', ''))) < 7 then
    raise exception using errcode = 'P0001', message = 'A valid contact number is required.';
  end if;

  v_hold_minutes := greatest(5, least(60, coalesce((v_tenant.booking_settings ->> 'holdMinutes')::integer, 15)));
  v_reference := 'DF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  insert into public.bookings (
    tenant_id, court_id, booking_reference, idempotency_key, booking_date, slots,
    customer_name, customer_phone, customer_email, customer_notes,
    status, payment_status, currency, total_amount, hold_expires_at, source
  ) values (
    v_tenant.id,
    v_court.id,
    v_reference,
    p_idempotency_key,
    p_booking_date,
    v_slots,
    btrim(p_customer_details ->> 'fullName'),
    btrim(p_customer_details ->> 'phone'),
    nullif(lower(btrim(p_customer_details ->> 'email')), ''),
    nullif(btrim(p_customer_details ->> 'notes'), ''),
    'pending',
    'unpaid',
    v_tenant.currency,
    v_total,
    now() + make_interval(mins => v_hold_minutes),
    'web'
  ) returning * into v_booking;

  begin
    insert into public.booking_slots (
      tenant_id, booking_id, court_id, booking_date, start_hour
    )
    select v_tenant.id, v_booking.id, v_court.id, p_booking_date, s
    from unnest(v_slots) s;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'A selected time was just booked. Please choose another time.';
  end;

  return jsonb_build_object(
    'bookingReference', v_booking.booking_reference,
    'accessToken', v_booking.guest_access_token,
    'status', v_booking.status,
    'paymentStatus', v_booking.payment_status,
    'totalAmount', v_booking.total_amount,
    'currency', v_booking.currency,
    'holdExpiresAt', v_booking.hold_expires_at,
    'idempotentReplay', false
  );
end;
$$;

create or replace function public.get_guest_booking_status(
  p_tenant_slug text,
  p_booking_reference text,
  p_access_token uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'bookingReference', b.booking_reference,
    'court', c.name,
    'date', b.booking_date,
    'slots', b.slots,
    'status', b.status,
    'paymentStatus', b.payment_status,
    'totalAmount', b.total_amount,
    'currency', b.currency,
    'holdExpiresAt', b.hold_expires_at,
    'createdAt', b.created_at
  )
  from public.bookings b
  join public.tenants t on t.id = b.tenant_id
  join public.courts c on c.tenant_id = b.tenant_id and c.id = b.court_id
  where t.slug = lower(btrim(p_tenant_slug))
    and b.booking_reference = upper(btrim(p_booking_reference))
    and b.guest_access_token = p_access_token;
$$;

-- Row-level security is mandatory on every application table.
alter table public.tenants enable row level security;
alter table public.tenant_domains enable row level security;
alter table public.profiles enable row level security;
alter table public.platform_admin_allowlist enable row level security;
alter table public.platform_admins enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.courts enable row level security;
alter table public.court_rate_rules enable row level security;
alter table public.tenant_settings enable row level security;
alter table public.blocked_dates enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_slots enable row level security;
alter table public.open_play_hosts enable row level security;
alter table public.open_play_sessions enable row level security;
alter table public.open_play_registrations enable row level security;
alter table public.payment_sessions enable row level security;
alter table public.payments enable row level security;
alter table public.receipts enable row level security;
alter table public.remittances enable row level security;
alter table public.agreements enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

create policy tenants_read_for_members on public.tenants for select to authenticated
  using (public.is_platform_admin() or public.has_tenant_role(id));
create policy tenants_insert_for_platform on public.tenants for insert to authenticated
  with check (public.is_platform_admin());
create policy tenants_update_for_owner on public.tenants for update to authenticated
  using (public.is_platform_admin() or public.has_tenant_role(id, array['owner']::public.membership_role[]))
  with check (public.is_platform_admin() or public.has_tenant_role(id, array['owner']::public.membership_role[]));
create policy tenants_delete_for_platform on public.tenants for delete to authenticated
  using (public.is_platform_admin());

create policy profiles_read_self_or_platform on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());
create policy profiles_update_self_or_platform on public.profiles for update to authenticated
  using (user_id = auth.uid() or public.is_platform_admin())
  with check (user_id = auth.uid() or public.is_platform_admin());

create policy platform_allowlist_platform_only on public.platform_admin_allowlist for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy platform_admins_read_self_or_platform on public.platform_admins for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());
create policy platform_admins_manage_platform on public.platform_admins for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy memberships_read_tenant on public.tenant_memberships for select to authenticated
  using (public.is_platform_admin() or public.has_tenant_role(tenant_id));
create policy memberships_manage_owner on public.tenant_memberships for all to authenticated
  using (public.is_platform_admin() or public.has_tenant_role(tenant_id, array['owner']::public.membership_role[]))
  with check (public.is_platform_admin() or public.has_tenant_role(tenant_id, array['owner']::public.membership_role[]));

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'tenant_domains', 'courts', 'court_rate_rules', 'tenant_settings',
    'blocked_dates', 'bookings', 'booking_slots', 'open_play_hosts',
    'open_play_sessions', 'open_play_registrations', 'payment_sessions',
    'payments', 'receipts', 'remittances', 'agreements', 'notifications'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using '
      || '(public.is_platform_admin() or public.has_tenant_role(tenant_id))',
      v_table || '_tenant_read', v_table
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check '
      || '(public.is_platform_admin() or public.has_tenant_role(tenant_id, '
      || 'array[''owner'',''staff'']::public.membership_role[]))',
      v_table || '_tenant_insert', v_table
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using '
      || '(public.is_platform_admin() or public.has_tenant_role(tenant_id, '
      || 'array[''owner'',''staff'']::public.membership_role[])) with check '
      || '(public.is_platform_admin() or public.has_tenant_role(tenant_id, '
      || 'array[''owner'',''staff'']::public.membership_role[]))',
      v_table || '_tenant_update', v_table
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using '
      || '(public.is_platform_admin() or public.has_tenant_role(tenant_id, '
      || 'array[''owner'']::public.membership_role[]))',
      v_table || '_tenant_delete', v_table
    );
  end loop;
end;
$$;

create policy audit_logs_tenant_read on public.audit_logs for select to authenticated
  using (public.is_platform_admin() or public.has_tenant_role(tenant_id, array['owner']::public.membership_role[]));

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.get_public_tenant(text) to anon, authenticated;
grant execute on function public.get_public_availability(text, date) to anon, authenticated;
grant execute on function public.create_guest_booking(text, uuid, date, integer[], jsonb, uuid) to anon, authenticated;
grant execute on function public.get_guest_booking_status(text, text, uuid) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('tenant-receipts', 'tenant-receipts', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf']),
  ('tenant-proofs', 'tenant-proofs', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy tenant_files_read on storage.objects for select to authenticated
  using (
    bucket_id in ('tenant-receipts', 'tenant-proofs')
    and (
      public.is_platform_admin()
      or public.has_tenant_role(public.storage_tenant_id(name))
    )
  );
create policy tenant_files_insert on storage.objects for insert to authenticated
  with check (
    bucket_id in ('tenant-receipts', 'tenant-proofs')
    and (
      public.is_platform_admin()
      or public.has_tenant_role(
        public.storage_tenant_id(name),
        array['owner','staff']::public.membership_role[]
      )
    )
  );
create policy tenant_files_update on storage.objects for update to authenticated
  using (
    bucket_id in ('tenant-receipts', 'tenant-proofs')
    and (
      public.is_platform_admin()
      or public.has_tenant_role(
        public.storage_tenant_id(name),
        array['owner','staff']::public.membership_role[]
      )
    )
  )
  with check (
    bucket_id in ('tenant-receipts', 'tenant-proofs')
    and (
      public.is_platform_admin()
      or public.has_tenant_role(
        public.storage_tenant_id(name),
        array['owner','staff']::public.membership_role[]
      )
    )
  );
create policy tenant_files_delete on storage.objects for delete to authenticated
  using (
    bucket_id in ('tenant-receipts', 'tenant-proofs')
    and (
      public.is_platform_admin()
      or public.has_tenant_role(
        public.storage_tenant_id(name),
        array['owner']::public.membership_role[]
      )
    )
  );

-- First real tenant. No demo users, bookings, payments, extra courts, or fake data.
insert into public.tenants (
  id, slug, name, status, timezone, address, locality, phone, facebook_url,
  logo_path, tagline, primary_color, accent_color, currency,
  booking_settings, payment_settings
) values (
  '00000000-0000-4000-8000-000000000001',
  'dfortees',
  'D’fortees Pickleball Court',
  'active',
  'Asia/Manila',
  'Prk-4 National Highway, 8801 Montevista',
  'Montevista, Davao de Oro',
  '09232579854',
  'https://www.facebook.com/Dfortees',
  'logodfortees.jpg',
  'Serve, rally, chill, repeat. Surrounded by golden trees, fresh air, and good vibes—our court is always ready when you are.',
  '#086b3a',
  '#f7dc42',
  'PHP',
  '{"holdMinutes": 15, "minimumAdvanceMinutes": 0, "maximumAdvanceDays": 60, "guestBookingEnabled": true}'::jsonb,
  '{"mode": "manual_per_tenant", "platformFeesEnabled": false, "sharedCredentialsEnabled": false}'::jsonb
);

insert into public.courts (
  id, tenant_id, slug, name, description, environment, open_hour, close_hour, is_active, sort_order
) values (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001',
  'main-court',
  'D’fortees Pickleball Court',
  'Outdoor pickleball court in Montevista, Davao de Oro.',
  'Outdoor',
  6,
  24,
  true,
  1
);

insert into public.court_rate_rules (
  tenant_id, court_id, label, start_hour, end_hour, rate_php, days_of_week
) values
  (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000101',
    'Day rate', 6, 18, 60, array[0,1,2,3,4,5,6]::smallint[]
  ),
  (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000101',
    'Evening rate', 18, 24, 90, array[0,1,2,3,4,5,6]::smallint[]
  );

commit;
