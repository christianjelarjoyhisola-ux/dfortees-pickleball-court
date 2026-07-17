const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = __dirname;
const logoName = 'logonewnew.png';
const oldLogoName = 'logodfortees.jpg';
const logoPath = path.join(root, logoName);
const htmlFiles = ['index.html', 'admin.html', 'login.html', 'host.html'];
const manifestFiles = [
  'tools/build-pages.js',
  'tools/local-server.js',
  'deploy-cloudflare-pages.ps1',
];

test('the canonical logo is a valid, mobile-safe PNG asset', () => {
  const logo = fs.readFileSync(logoPath);
  assert.deepEqual([...logo.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(logo.readUInt32BE(16), 1200);
  assert.equal(logo.readUInt32BE(20), 1200);
  assert.ok(logo.length <= 1024 * 1024, 'logo must remain at or below 1 MiB');
});

test('every page uses the new logo and a cache-busted shared brand source', () => {
  for (const file of htmlFiles) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, new RegExp(`rel="icon" type="image/png" href="${logoName.replace('.', '\\.')}"`));
    assert.match(source, /brand-config\.js\?v=20260717-logo-v2/);
    assert.doesNotMatch(source, new RegExp(oldLogoName.replace('.', '\\.')));
  }

  const brand = fs.readFileSync(path.join(root, 'brand-config.js'), 'utf8');
  assert.match(brand, new RegExp(`logo: '${logoName.replace('.', '\\.')}’?`));
  assert.doesNotMatch(brand, new RegExp(oldLogoName.replace('.', '\\.')));
});

test('local preview, Pages build, direct deploy, and email fallbacks include the new logo', () => {
  for (const file of manifestFiles) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, new RegExp(logoName.replace('.', '\\.')));
    assert.doesNotMatch(source, new RegExp(oldLogoName.replace('.', '\\.')));
  }

  for (const file of [
    'supabase/functions/send-confirmation-email/index.ts',
    'supabase/functions/send-reschedule-email/index.ts',
    'supabase/functions/process-host-balance-deadlines/index.ts',
  ]) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, new RegExp(`dforteespickleball\\.com/${logoName.replace('.', '\\.')}`));
    assert.doesNotMatch(source, /dfortees-pickleball-court\.pages\.dev/);
  }
});

test('cached requests for the previous logo are redirected to the new brand asset', () => {
  const worker = fs.readFileSync(path.join(root, '_worker.js'), 'utf8');
  assert.match(worker, /url\.pathname === '\/logodfortees\.jpg'/);
  assert.match(worker, /new URL\('\/logonewnew\.png', url\)/);
  assert.match(worker, /Response\.redirect\([\s\S]*?, 301\)/);
});
