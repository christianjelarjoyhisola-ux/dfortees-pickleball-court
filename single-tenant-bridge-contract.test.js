const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = __dirname;
const bridgeName = 'single-tenant-api.js';
const bridge = fs.readFileSync(path.join(root, bridgeName), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260717130000_single_tenant_security.sql'),
  'utf8'
);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('every application page loads runtime config, Supabase, the adapter, then the secure bridge', () => {
  for (const page of ['index.html', 'admin.html', 'login.html', 'host.html', 'player-live.html']) {
    const html = read(page);
    const runtimeAt = html.indexOf('src="/runtime-config.js"');
    const libraryAt = html.indexOf('src="supabase.min.js"');
    const adapterAt = html.indexOf('src="supabase-config.js');
    const bridgeAt = html.indexOf(`src="${bridgeName}`);
    assert.ok(runtimeAt >= 0, `${page} must load runtime-config.js`);
    assert.ok(runtimeAt < libraryAt && libraryAt < adapterAt && adapterAt < bridgeAt, `${page} script order is unsafe`);
  }
});

test('local builds and Cloudflare deployment include the secure bridge', () => {
  assert.match(read('tools/build-pages.js'), new RegExp(`['"]${bridgeName.replace('.', '\\.')}['"]`));
  assert.match(read('deploy-cloudflare-pages.ps1'), new RegExp(`['"]${bridgeName.replace('.', '\\.')}['"]`));
});

test('the bridge and migration expose the same reviewed public RPC surface', () => {
  const rpcNames = [...bridge.matchAll(/rpc\('([a-z0-9_]+)'/g)].map(match => match[1]);
  const uniqueNames = [...new Set(rpcNames)];
  assert.deepEqual(uniqueNames.sort(), [
    'cancel_guest_booking',
    'create_guest_booking',
    'create_public_host_application',
    'create_public_host_session_registration',
    'create_public_open_play_registration',
    'get_guest_booking_status',
    'get_public_availability',
    'get_public_open_play_counts',
    'get_public_open_play_host_sessions',
    'get_public_settings',
    'update_guest_booking',
  ].sort());

  for (const name of uniqueNames) {
    assert.match(migration, new RegExp(`create or replace function public\\.${name}\\(`, 'i'));
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}\\([^;]*to anon, authenticated;`, 'i'));
  }
});

test('guest booking mutations always use private access tokens and stable idempotency keys', () => {
  assert.match(bridge, /p_idempotency_key:\s*idempotencyFor\(reference\)/);
  assert.match(bridge, /get_guest_booking_status[\s\S]*?p_access_token:\s*accessToken/);
  assert.match(bridge, /update_guest_booking[\s\S]*?p_access_token:\s*accessToken/);
  assert.match(bridge, /cancel_guest_booking[\s\S]*?p_access_token:\s*accessToken/);
  assert.match(bridge, /rememberAccess\(result\.bookingReference, result\.accessToken\)/);
  assert.match(bridge, /p_idempotency_key:\s*idempotencyFor\(requestKey\)/g);
  assert.doesNotMatch(bridge, /p_idempotency_key:\s*crypto\.randomUUID\(\)/);
});

test('anonymous reads cannot fall back to PII tables or legacy browser seeding', () => {
  assert.match(bridge, /window\.DB\.seedDefaultData = async function singleTenantSeedIsServerManaged/);
  assert.doesNotMatch(bridge, /singleTenantSeedIsServerManaged[\s\S]{0,300}original\.seedDefaultData/);
  assert.match(bridge, /window\.DB\.getSettings[\s\S]*?rpc\('get_public_settings'/);
  assert.match(bridge, /window\.DB\.getBookings[\s\S]*?rpc\('get_public_availability'/);
  assert.match(bridge, /window\.DB\.getOpenPlayRegistrations[\s\S]*?: \[\]/);
  assert.match(bridge, /rpc\('get_public_open_play_host_sessions'/);
  assert.match(bridge, /rpc\('create_public_host_application'/);
  assert.doesNotMatch(bridge, /\.from\(['"](?:bookings|settings|open_play_registrations|open_play_host_applications)['"]\)/);
});

test('only validated active dashboard roles use the authenticated legacy adapter', () => {
  assert.match(bridge, /const session = window\.Auth\?\.getSession\?\.\(\)/);
  assert.match(bridge, /session\.status === 'active'/);
  for (const role of ['owner', 'court_owner', 'staff', 'host']) {
    assert.match(bridge, new RegExp(`['"]${role}['"]`));
  }
  assert.doesNotMatch(bridge, /sb\.auth\.getSession\(\)/);
});

test('runtime configuration is public-only and locked to the reviewed backend', () => {
  const config = read('supabase-config.js');
  const worker = read('_worker.js');
  assert.match(config, /window\.PB_RUNTIME_CONFIG/);
  assert.match(config, /https:\/\/dfortees-backend\.invalid/);
  assert.match(worker, /env\.PB_SUPABASE_URL/);
  assert.match(worker, /env\.PB_SUPABASE_PUBLISHABLE_KEY/);
  const privateCredentialPattern = new RegExp(
    [
      'sb_secret_',
      `${['service', 'role'].join('_')}\\s*[:=]`,
      'SUPABASE_DB_PASSWORD',
    ].join('|'),
    'i',
  );
  assert.doesNotMatch(config + bridge + worker, privateCredentialPattern);
  assert.doesNotMatch(config + bridge, /https:\/\/[a-z0-9-]+\.supabase\.co/i);
  const workerProjectUrls = [...worker.matchAll(/https:\/\/[a-z0-9-]+\.supabase\.co/gi)]
    .map(match => match[0]);
  assert.deepEqual(
    [...new Set(workerProjectUrls)],
    ['https://ebykgvvjsuawawdheyil.supabase.co'],
  );
});
