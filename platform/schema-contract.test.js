const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const migrationPath = path.join(
  __dirname,
  'supabase',
  'migrations',
  '20260716000000_multitenant_baseline.sql'
);
const sql = fs.readFileSync(migrationPath, 'utf8');

const tenantTables = [
  'tenant_domains',
  'tenant_memberships',
  'courts',
  'court_rate_rules',
  'tenant_settings',
  'blocked_dates',
  'bookings',
  'booking_slots',
  'open_play_hosts',
  'open_play_sessions',
  'open_play_registrations',
  'payment_sessions',
  'payments',
  'receipts',
  'remittances',
  'agreements',
  'notifications',
  'audit_logs',
];

test('every tenant-owned table enables row-level security', () => {
  for (const table of tenantTables) {
    assert.match(
      sql,
      new RegExp(`alter table public\\.${table} enable row level security;`, 'i'),
      `${table} must have RLS enabled`
    );
  }
});

test('public guest operations are RPC-only', () => {
  assert.match(sql, /revoke all on all tables in schema public from anon, authenticated;/i);
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete)[^;]*\s+to\s+anon/i);

  for (const rpc of [
    'get_public_tenant',
    'get_public_availability',
    'create_guest_booking',
    'get_guest_booking_status',
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${rpc}\\(`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function public\\.${rpc}\\(`, 'i'));
  }
});

test('guest cancellation is access-token bound and releases through booking status', () => {
  const cancellationSql = fs.readFileSync(
    path.join(__dirname, 'supabase', 'migrations', '20260716005000_public_rates_and_guest_cancellation.sql'),
    'utf8'
  );
  assert.match(cancellationSql, /b\.guest_access_token = p_access_token/i);
  assert.match(cancellationSql, /set status = 'cancelled'/i);
  assert.match(cancellationSql, /grant execute on function public\.cancel_guest_booking[^;]*to anon, authenticated;/i);
});

test('authenticated RLS policies can execute only their narrow helper functions', () => {
  const grants = fs.readFileSync(
    path.join(__dirname, 'supabase', 'migrations', '20260716004000_rls_helper_execute_grants.sql'),
    'utf8'
  );
  for (const helper of ['is_platform_admin', 'has_tenant_role', 'storage_tenant_id', 'shares_active_tenant']) {
    assert.match(grants, new RegExp(`grant execute on function public\\.${helper}\\(`, 'i'));
    assert.match(grants, new RegExp(`revoke all on function public\\.${helper}\\(`, 'i'));
  }
  assert.doesNotMatch(grants, /grant execute[^;]*to anon/i);
});

test('active court slots and idempotency are database-enforced', () => {
  assert.match(
    sql,
    /create unique index booking_slots_one_active_reservation[\s\S]*tenant_id, court_id, booking_date, start_hour[\s\S]*where released_at is null;/i
  );
  assert.match(sql, /unique \(tenant_id, idempotency_key\)/i);
  assert.match(sql, /create trigger bookings_release_inactive_slots/i);
});

test('the baseline seeds only the real D’fortees venue and one court', () => {
  const seed = sql.split('-- First real tenant.')[1];
  assert.ok(seed, 'the D’fortees seed section must exist');
  assert.match(seed, /'dfortees'/i);
  assert.match(seed, /'D’fortees Pickleball Court'/);
  assert.match(seed, /'Day rate', 6, 18, 60/);
  assert.match(seed, /'Evening rate', 18, 24, 90/);
  assert.doesNotMatch(seed, /Court (?:2|3|4|5|6|7|8|9|10)/i);
  assert.doesNotMatch(seed, /insert into public\.(?:bookings|payments|open_play_sessions)\s*\(/i);
});

test('private files are tenant-prefixed and never public', () => {
  assert.match(sql, /'tenant-receipts', 'tenant-receipts', false/i);
  assert.match(sql, /'tenant-proofs', 'tenant-proofs', false/i);
  assert.match(sql, /public\.storage_tenant_id\(name\)/i);
});
