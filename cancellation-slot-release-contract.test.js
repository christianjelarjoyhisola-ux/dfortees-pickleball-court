const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = __dirname;
const migrationName = '20260718090000_atomic_booking_cancellation.sql';
const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', migrationName), 'utf8');
const compactSql = sql.replace(/\s+/g, ' ');
const dataLayer = fs.readFileSync(path.join(root, 'supabase-config.js'), 'utf8');
const guestBridge = fs.readFileSync(path.join(root, 'single-tenant-api.js'), 'utf8');
const customerUi = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function sqlFunction(name) {
  const start = compactSql.toLowerCase().indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} must be defined`);
  const end = compactSql.indexOf('$$;', start);
  assert.ok(end > start, `${name} must have a complete body`);
  return compactSql.slice(start, end + 3);
}

test('cancelled and expired bookings cannot retain a court-hour lock', () => {
  assert.match(compactSql, /delete from public\.booking_slots where booking_ref = new\.ref; if new\.status in \('cancelled', 'forfeited'\)/i);
  assert.match(compactSql, /after insert or update of court_id, date, slots, status, hold_expires_at on public\.bookings/i);
  assert.match(compactSql, /delete from public\.booking_slots as locked using public\.bookings as booking[^;]+booking\.status in \('cancelled', 'forfeited'\)[^;]+booking\.hold_expires_at <= now\(\)/i);
  assert.doesNotMatch(
    sql,
    /\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:settings|courts)\b/i,
    'slot release migration must never reset venue settings or courts',
  );
});

test('dashboard cancellation is privileged, role-scoped, and atomic', () => {
  const fn = sqlFunction('cancel_authenticated_booking');
  assert.match(sql, /create or replace function public\.cancel_authenticated_booking\(/i);
  assert.match(fn, /security definer set search_path = public, pg_temp/i);
  assert.match(fn, /v_role not in \('owner', 'court_owner', 'staff', 'host'\)/i);
  assert.match(fn, /v_role = 'host'[\s\S]+v_booking\.host_user_id is distinct from auth\.uid\(\)/i);
  assert.match(fn, /update public\.bookings set status = 'cancelled'[\s\S]+where ref = p_booking_ref returning \* into v_booking;/i);
  assert.match(fn, /delete from public\.booking_slots where booking_ref = p_booking_ref;/i);
  assert.match(sql, /grant execute on function public\.cancel_authenticated_booking\(text, text, text\) to authenticated;/i);
  assert.doesNotMatch(sql, /grant execute on function public\.cancel_authenticated_booking[^;]+\bto anon\b/i);
  assert.match(dataLayer, /_sb\.rpc\('cancel_authenticated_booking'/);
  assert.match(dataLayer, /data\.status !== 'cancelled' \|\| data\.released !== true/);
});

test('guest cancellation confirms the server release before clearing local access', () => {
  const fn = sqlFunction('cancel_guest_booking');
  assert.match(fn, /update public\.bookings set status = 'cancelled'[\s\S]+guest_access_token = p_access_token/i);
  assert.match(fn, /delete from public\.booking_slots where booking_ref = p_booking_ref;/i);
  assert.match(compactSql, /'released', true/i);
  assert.match(guestBridge, /cancelled\?\.status !== 'cancelled' \|\| cancelled\?\.released !== true/);
  assert.match(guestBridge, /result\?\.status !== 'cancelled' \|\| result\?\.released !== true/);
});

test('customer UI does not silently discard cancellation failures', () => {
  const start = customerUi.indexOf('async function cancelReservedBookings');
  const end = customerUi.indexOf('\nfunction clearSelectedBookingUi', start);
  assert.ok(start >= 0 && end > start, 'cancelReservedBookings must be defined');
  const implementation = customerUi.slice(start, end);
  assert.match(implementation, /Promise\.allSettled/);
  assert.match(implementation, /failures\.length/);
  assert.match(implementation, /throw firstError instanceof Error/);
  assert.doesNotMatch(implementation, /\.catch\(\(\) => \{\}\)/);
});

test('fresh database builds include the cancellation release before final grants', () => {
  const builder = fs.readFileSync(path.join(root, 'tools', 'build-fresh-database-bundle.ps1'), 'utf8');
  const cancellationPosition = builder.indexOf(migrationName);
  const serviceRolePosition = builder.indexOf('20260717214500_restore_service_role_privileges.sql');
  assert.ok(cancellationPosition >= 0, 'fresh bundle must include the cancellation migration');
  assert.ok(serviceRolePosition > cancellationPosition, 'final service-role grants must remain last');
});
