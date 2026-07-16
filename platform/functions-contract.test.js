const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function read(...parts) {
  return fs.readFileSync(path.join(__dirname, ...parts), 'utf8');
}

const shared = read('supabase', 'functions', '_shared', 'tenant-context.ts');
const manageMember = read('supabase', 'functions', 'manage-member', 'index.ts');
const fileUpload = read('supabase', 'functions', 'create-file-upload', 'index.ts');
const deployScript = fs.readFileSync(path.join(__dirname, '..', 'deploy-edge-functions.ps1'), 'utf8');

test('service-role functions resolve and enforce tenant context', () => {
  assert.match(shared, /resolveTenant/);
  assert.match(shared, /requireTenantRole/);
  assert.match(shared, /tenant_memberships/);
  assert.match(shared, /platform_admins/);
  assert.match(manageMember, /resolveTenant\(db, body\.tenantSlug\)/);
  assert.match(manageMember, /requireTenantRole\(db, caller\.id, tenant/);
});

test('guest upload signs only tenant-prefixed private booking paths', () => {
  assert.match(fileUpload, /eq\("tenant_id", tenant\.id\)/);
  assert.match(fileUpload, /eq\("guest_access_token", accessToken\)/);
  assert.match(fileUpload, /const path = `\$\{tenant\.id\}\/bookings\/\$\{booking\.id\}/);
  assert.match(fileUpload, /from\("tenant-receipts"\)/);
  assert.doesNotMatch(fileUpload, /getPublicUrl/);
});

test('deployment allowlist contains no legacy single-tenant functions', () => {
  assert.match(deployScript, /manage-member/);
  assert.match(deployScript, /create-file-upload/);
  for (const legacyName of [
    'verify-gcash-receipt',
    'payment-webhook',
    'host-application',
    'manage-account',
    'send-telegram-notification',
  ]) {
    assert.doesNotMatch(deployScript, new RegExp(legacyName));
  }
});

