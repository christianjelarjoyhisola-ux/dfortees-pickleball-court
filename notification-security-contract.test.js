const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('customer notification functions authorize a booking before using server data', () => {
  for (const name of ['send-confirmation-email', 'send-reschedule-email', 'send-telegram-notification']) {
    const source = read(`supabase/functions/${name}/index.ts`);
    assert.match(source, /resolveBookingAccess\(req,/);
  }

  for (const name of ['send-confirmation-email', 'send-telegram-notification']) {
    const source = read(`supabase/functions/${name}/index.ts`);
    assert.match(source, /guestAccessToken/);
  }

  const confirmation = read('supabase/functions/send-confirmation-email/index.ts');
  assert.match(confirmation, /email:\s*first\.email/);
  assert.match(confirmation, /total\s*=\s*rows\.reduce/);

  const reschedule = read('supabase/functions/send-reschedule-email/index.ts');
  assert.match(reschedule, /adminOnly:\s*true/);
  assert.match(reschedule, /email:\s*booking\.email/);
  assert.doesNotMatch(reschedule, /email:\s*requestBody\.email/);

  const telegram = read('supabase/functions/send-telegram-notification/index.ts');
  assert.match(telegram, /fullName:\s*String\(row\.full_name/);
  assert.match(telegram, /total:\s*Number\(row\.total/);
});

test('scheduled host balance processing rejects unsigned scheduler requests', () => {
  const source = read('supabase/functions/process-host-balance-deadlines/index.ts');
  const auth = read('supabase/functions/_shared/notification-auth.ts');
  assert.match(source, /authorizeScheduledRequest\(req, db\)/);
  assert.match(source, /requireActiveAdmin\(req, db\)/);
  assert.match(auth, /HOST_BALANCE_CRON_SECRET/);
  assert.match(auth, /service_role/);
  assert.match(auth, /Scheduled processor authorization is required/);
});

test('anonymous browser notification calls attach the private booking token', () => {
  const bridge = read('single-tenant-api.js');
  const adapter = read('supabase-config.js');
  assert.match(bridge, /sendSingleTenantConfirmation/);
  assert.match(bridge, /sendSingleTenantTelegram/);
  assert.match(adapter, /guestAccessToken:\s*b\.guestAccessToken/);
});
