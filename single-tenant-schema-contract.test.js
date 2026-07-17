const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = __dirname;
const migrationName = '20260717130000_single_tenant_security.sql';
const pricingRepairName = '20260717150000_restore_dfortees_pricing.sql';
const feeRepairName = '20260717213000_restore_dfortees_booking_fee.sql';
const serviceRoleRepairName = '20260717214500_restore_service_role_privileges.sql';
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName);
const sql = fs.readFileSync(migrationPath, 'utf8');
const compactSql = sql.replace(/\s+/g, ' ');
const pricingRepairSql = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', pricingRepairName),
  'utf8',
);
const compactPricingRepairSql = pricingRepairSql.replace(/\s+/g, ' ');
const feeRepairSql = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', feeRepairName),
  'utf8',
);
const compactFeeRepairSql = feeRepairSql.replace(/\s+/g, ' ');
const serviceRoleRepairSql = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', serviceRoleRepairName),
  'utf8',
);
const compactServiceRoleRepairSql = serviceRoleRepairSql.replace(/\s+/g, ' ');

function functionContract(name, signaturePattern) {
  const startPattern = new RegExp(`create or replace function public\\.${name}\\(`, 'i');
  const start = sql.search(startPattern);
  assert.ok(start >= 0, `${name} must be defined`);
  const end = sql.indexOf('$$;', start);
  assert.ok(end > start, `${name} must have a complete SQL body`);
  const definition = sql.slice(start, end + 3);
  assert.match(definition, /returns jsonb/i, `${name} must return one JSON object`);
  assert.match(definition, /security definer/i, `${name} must use its reviewed privileged implementation`);
  assert.match(definition, /set search_path = public, pg_temp/i, `${name} must pin its search path`);
  assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\(${signaturePattern}\\) from public;`, 'i'));
  assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\(${signaturePattern}\\) to anon, authenticated;`, 'i'));
}

test('fresh database bundle is guarded and excludes one-time setting repairs', () => {
  const builder = fs.readFileSync(path.join(root, 'tools', 'build-fresh-database-bundle.ps1'), 'utf8');
  assert.match(builder, new RegExp(`supabase\\\\migrations\\\\${migrationName.replaceAll('.', '\\.')}[^)]*\\)`, 'i'));
  assert.doesNotMatch(builder, /platform\\supabase|multitenant|multi-tenant/i);
  const hardeningPosition = builder.indexOf(migrationName);
  const limiterPosition = builder.indexOf('20260717143000_receipt_verification_rate_limit.sql');
  const serviceRoleRepairPosition = builder.indexOf(serviceRoleRepairName);
  assert.ok(hardeningPosition >= 0 && limiterPosition > hardeningPosition);
  assert.ok(
    serviceRoleRepairPosition > limiterPosition,
    'service-role repair must be the latest bundled migration',
  );
  assert.doesNotMatch(builder, new RegExp(pricingRepairName.replaceAll('.', '\\.')));
  assert.doesNotMatch(builder, new RegExp(feeRepairName.replaceAll('.', '\\.')));
  assert.match(builder, /to_regclass\('public\.settings'\) is not null/i);
  assert.match(builder, /to_regclass\('public\.courts'\) is not null/i);
  assert.match(builder, /REFUSED: D''fortees fresh database SQL cannot run on an existing application database/i);
});

test('the historical one-time booking-fee repair is booking-safe and not replayable', () => {
  for (const key of ['maintenance_fee', 'service_fee_rate', 'booking_fee']) {
    assert.match(
      compactFeeRepairSql,
      new RegExp(`\\('${key}', '5'\\)`, 'i'),
    );
  }
  assert.match(compactFeeRepairSql, /\('fee_type', 'per_hour'\)/i);
  assert.match(compactFeeRepairSql, /on conflict \(key\) do update/i);
  assert.match(compactFeeRepairSql, /calculate_booking_service_fee\(array\['17'\]::text\[\]\)/i);
  assert.match(compactFeeRepairSql, /v_fee is distinct from 5::numeric/i);
  assert.doesNotMatch(
    feeRepairSql,
    /\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:bookings|booking_slots)\b/i,
    'fee repair must never mutate bookings or reserved slots',
  );
});

test('trusted Edge Functions retain explicit service-role database privileges', () => {
  assert.match(
    compactServiceRoleRepairSql,
    /grant select, insert, update, delete on all tables in schema public to service_role;/i,
  );
  assert.match(
    compactServiceRoleRepairSql,
    /grant usage, select on all sequences in schema public to service_role;/i,
  );
  assert.match(compactServiceRoleRepairSql, /has_table_privilege\('service_role', 'public\.bookings', 'SELECT'\)/i);
  assert.match(compactServiceRoleRepairSql, /has_table_privilege\('service_role', 'public\.receipt_verifications', 'INSERT'\)/i);
  assert.doesNotMatch(serviceRoleRepairSql, /\bgrant\b[^;]*\bto\s+(?:anon|authenticated)\b/i);
});

test('the historical one-time pricing repair is booking-safe and not replayable', () => {
  const canonicalSchedule = /\[{"from":6,"to":18,"rate":60},{"from":18,"to":24,"rate":90}\]/;

  assert.match(compactPricingRepairSql, /if not exists \(select 1 from public\.courts where id = 'c1'\) then/i);
  assert.match(compactPricingRepairSql, /update public\.courts set rate = 60, rate_schedule = v_rate_schedule where id = 'c1' and \(/i);
  assert.match(pricingRepairSql, canonicalSchedule);
  assert.match(compactPricingRepairSql, /insert into public\.settings as current_setting \(key, value\) values \('pricing_tiers', v_rate_schedule::text\) on conflict \(key\) do update/i);
  assert.match(compactPricingRepairSql, /where current_setting\.value is distinct from excluded\.value;/i);
  assert.match(compactPricingRepairSql, /calculate_booking_court_total\('c1', array\['17'\]::text\[\]\)/i);
  assert.match(compactPricingRepairSql, /calculate_booking_court_total\('c1', array\['18'\]::text\[\]\)/i);
  assert.match(compactPricingRepairSql, /v_day_rate is distinct from 60::numeric/i);
  assert.match(compactPricingRepairSql, /v_evening_rate is distinct from 90::numeric/i);
  assert.doesNotMatch(
    pricingRepairSql,
    /\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:bookings|booking_slots)\b/i,
    'pricing repair must never mutate bookings or reserved slots',
  );
});

test('the migration is dedicated to one venue and has no tenant discriminator', () => {
  assert.match(sql, /Dedicated single-tenant security baseline for D'fortees Pickleball Court/i);
  assert.doesNotMatch(sql, /\btenant_(?:id|slug|membership|domain)s?\b/i);
  assert.doesNotMatch(sql, /create table[^;]*public\.tenants\b/i);
});

test('active court slots are atomic and expired or cancelled holds release them', () => {
  assert.match(compactSql, /create table if not exists public\.booking_slots \([^;]*primary key \(court_id, booking_date, start_hour\)[^;]*unique \(booking_ref, start_hour\)/i);
  assert.match(sql, /alter table public\.booking_slots enable row level security;/i);
  assert.match(sql, /drop trigger if exists check_booking_conflict on public\.bookings;/i);
  assert.match(compactSql, /create trigger trg_sync_booking_slots after insert or update of court_id, date, slots, status, hold_expires_at on public\.bookings for each row execute function public\.sync_booking_slots\(\);/i);
  assert.match(compactSql, /if new\.status in \('cancelled', 'forfeited'\)[^;]*new\.hold_expires_at <= now\(\)[^;]*return new;/i);
  assert.match(sql, /create unique index if not exists bookings_idempotency_key_unique/i);
});

test('guest booking RPCs are token-bound, idempotent, and server-priced', () => {
  functionContract('get_public_settings', '');
  functionContract('get_public_availability', 'date');
  functionContract('create_guest_booking', 'jsonb, uuid, text');
  functionContract('get_guest_booking_status', 'text, uuid');
  functionContract('update_guest_booking', 'text, uuid, jsonb');
  functionContract('cancel_guest_booking', 'text, uuid, text');

  assert.match(sql, /where idempotency_key = p_idempotency_key/i);
  assert.match(sql, /guest_access_token = p_access_token/gi);
  assert.match(sql, /calculate_booking_court_total\(v_court_id, v_slots\)/i);
  assert.match(sql, /calculate_booking_service_fee\(v_slots\)/i);
  assert.match(sql, /'bookingReference', v_booking\.ref/i);
  assert.match(sql, /'accessToken', v_booking\.guest_access_token/i);
});

test('public Open Play and host operations use narrow RPCs with server-side capacity controls', () => {
  functionContract('get_public_open_play_counts', 'date');
  functionContract('create_public_open_play_registration', 'jsonb, uuid');
  functionContract('get_public_open_play_host_sessions', '');
  functionContract('create_public_host_session_registration', 'jsonb, uuid');
  functionContract('create_public_host_application', 'jsonb');

  assert.match(sql, /pg_advisory_xact_lock\(/i);
  assert.match(compactSql, /select \* into v_session from public\.open_play_host_sessions where id = v_session_id and status = 'published' for update;/i);
  assert.match(sql, /where status = 'published'/i);
  assert.match(sql, /'hostEmail', ''/i);
  assert.match(sql, /'paymentInstructions', ''/i);
});

test('anonymous table access cannot expose booking or registration PII', () => {
  for (const policy of [
    'bookings_select_public',
    'bookings_insert_public',
    'bookings_update_public_hold',
    'open_play_select_public',
    'open_play_insert_public',
    'open_play_host_applications_insert_public',
    'open_play_host_sessions_select_public',
    'settings_select_public',
  ]) {
    assert.match(sql, new RegExp(`drop policy if exists ${policy}`, 'i'), `${policy} must be removed`);
  }

  for (const table of [
    'bookings',
    'booking_slots',
    'open_play_registrations',
    'open_play_host_applications',
    'open_play_host_sessions',
    'open_play_host_session_registrations',
    'receipt_verifications',
    'settings',
  ]) {
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from [^;]*anon`, 'i'), `${table} must be revoked from anon`);
  }

  assert.match(sql, /grant select on public\.courts, public\.blocked_dates to anon;/i);
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete)[^;]*public\.(?:bookings|booking_slots|open_play_registrations|settings)[^;]*to anon/i);
  for (const operation of ['select', 'insert', 'update', 'delete']) {
    assert.match(sql, new RegExp(`drop policy if exists receipts_no_${operation} on storage\\.objects;`, 'i'));
  }
});

test("the final seed contains only D'fortees, correct hours and cash-only payments", () => {
  const seed = sql.split('-- Replace the generic starter records with the real D\'fortees venue only.')[1];
  assert.ok(seed, "D'fortees seed section must exist");
  const compactSeed = seed.replace(/\s+/g, ' ');

  assert.match(compactSeed, /delete from public\.courts where id in \('c1','c2'\) and name in \('Court Alpha','Court Beta'\);/i);
  assert.match(seed, /'D''fortees Pickleball Court'/i);
  assert.match(seed, /'Prk-4 National Highway, 8801 Montevista'/i);
  assert.match(seed, /'09232579854'/);
  assert.match(seed, /https:\/\/www\.facebook\.com\/Dfortees/i);
  assert.match(compactSeed, /\[\{"from":6,"to":18,"rate":60\},\{"from":18,"to":24,"rate":90\}\]/);
  assert.match(seed, /\('open_hour', '6'\)/i);
  assert.match(seed, /\('close_hour', '24'\)/i);
  assert.match(seed, /\('payment_method_cash', '1'\)/i);
  for (const method of ['gcash', 'bdopay', 'maya', 'bpi', 'gotyme', 'pnb']) {
    assert.match(seed, new RegExp(`\\('payment_method_${method}', '0'\\)`, 'i'));
  }
  assert.match(seed, /\('gcash_checkout_enabled', '0'\)/i);
  assert.doesNotMatch(seed, /insert into public\.(?:accounts|bookings|open_play_registrations|payment_sessions)\b/i);
  const courtInsert = compactSeed.match(/insert into public\.courts\([^;]+?on conflict \(id\) do update set[^;]+;/i);
  assert.ok(courtInsert, 'one final court upsert must exist');
  assert.doesNotMatch(courtInsert[0], /Court (?:Alpha|Beta|[2-9]|10)/i);
});
