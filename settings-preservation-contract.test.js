const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = __dirname;
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const dataLayer = read('supabase-config.js');
const admin = read('admin.html');
const worker = read('_worker.js');
const cloudflareDeploy = read('deploy-cloudflare-pages.ps1');
const edgeDeploy = read('deploy-edge-functions.ps1');
const freshBuilder = read('tools/build-fresh-database-bundle.ps1');
const setupSql = read('SETUP_NEW_SUPABASE.sql');
const readme = read('README.md');

test('failed settings reads cannot be cached or presented as editable defaults', () => {
  const settingsStart = dataLayer.indexOf('async getSettings()');
  const settingsEnd = dataLayer.indexOf('async saveSetting(', settingsStart);
  const getSettings = dataLayer.slice(settingsStart, settingsEnd);

  assert.match(getSettings, /throw new Error\('Could not load saved system settings\. Nothing was changed\.'\)/);
  assert.doesNotMatch(getSettings, /if \(error\)[^{]*\{[^}]*return \{\}/s);
  assert.match(admin, /let _paymentSettingsLoaded = false;/);
  assert.match(admin, /if \(!_paymentSettingsLoaded\)[\s\S]*?Nothing was changed\./);
  assert.match(admin, /id="savePaymentSettingsBtn"[^>]*disabled/);
  assert.doesNotMatch(
    admin,
    /id="paymentAcceptanceModeSelect"[^>]*onchange="savePaymentSettings\(\)"/,
  );
});

test('related settings are saved in one batch instead of partial sequential writes', () => {
  assert.match(dataLayer, /async saveSettings\(values\)[\s\S]*?\.upsert\(rows, \{ onConflict: 'key' \}\)/);
  assert.match(admin, /await DB\.saveSettings\(updates\);/);

  const paymentSaveStart = admin.indexOf('async function savePaymentSettings()');
  const paymentSaveEnd = admin.indexOf('/* ==============================================', paymentSaveStart);
  const paymentSave = admin.slice(paymentSaveStart, paymentSaveEnd);
  assert.doesNotMatch(paymentSave, /await DB\.saveSetting\(/);
  assert.doesNotMatch(paymentSave, /platform_gcash_qr/);
  for (const key of [
    'payment_method_cash',
    'payment_method_gcash',
    'payment_acceptance_mode',
    'gcash_merchant_number',
    'gcash_merchant_name',
  ]) {
    assert.match(paymentSave, new RegExp(`${key}:`));
  }
});

test('missing settings and stale QR previews cannot silently replace saved values', () => {
  for (const method of ['cash', 'gcash', 'bdopay', 'maya', 'bpi', 'gotyme', 'pnb']) {
    assert.match(admin, new RegExp(`settings\\.payment_method_${method} === '1'`));
  }
  for (const preview of ['gcashQrPreview', 'gotymeQrPreview', 'pnbQrPreview']) {
    assert.match(
      admin,
      new RegExp(`\\$\\('${preview}'\\)\\.src = [a-z]+Qr;[\\s\\S]*?style\\.display = [a-z]+Qr \\? '' : 'none'`),
    );
  }
  assert.match(admin, /DB\.clearCache\?\.\(\['settings'\]\);[\s\S]*?rerender\(\);/);
});

test('runtime and direct deployment are locked to the existing Dfortees project', () => {
  const projectUrl = 'https://ebykgvvjsuawawdheyil.supabase.co';
  assert.match(worker, new RegExp(projectUrl.replaceAll('.', '\\.')));
  assert.match(worker, /isExpectedProject/);
  assert.match(cloudflareDeploy, new RegExp(projectUrl.replaceAll('.', '\\.')));
  assert.match(cloudflareDeploy, /Refusing to point D'fortees at a different Supabase project/);
});

test('normal website and function deployments never execute database migrations', () => {
  const forbidden = /\b(?:db\s+(?:reset|push)|migration\s+up|psql|dfortees-fresh-database\.sql)\b/i;
  assert.doesNotMatch(cloudflareDeploy, forbidden);
  assert.doesNotMatch(edgeDeploy, forbidden);
});

test('fresh SQL aborts on existing application tables and omits repair migrations', () => {
  for (const table of ['settings', 'courts', 'bookings', 'accounts']) {
    assert.match(freshBuilder, new RegExp(`to_regclass\\('public\\.${table}'\\) is not null`, 'i'));
    assert.match(setupSql, new RegExp(`to_regclass\\('public\\.${table}'\\) is not null`, 'i'));
  }
  assert.match(freshBuilder, /REFUSED: D''fortees fresh database SQL cannot run on an existing application database/);
  assert.match(setupSql, /REFUSED: SETUP_NEW_SUPABASE\.sql is fresh-install only and cannot update an existing database/);
  assert.doesNotMatch(freshBuilder, /20260717150000_restore_dfortees_pricing\.sql/);
  assert.doesNotMatch(freshBuilder, /20260717213000_restore_dfortees_booking_fee\.sql/);
  assert.match(readme, /live operational settings stored in Supabase/i);
  assert.match(readme, /must be preserved across every code, UI, function,[\s\S]*Cloudflare update/i);
});
