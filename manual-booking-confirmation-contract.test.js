const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = __dirname;
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const verifier = fs.readFileSync(
  path.join(root, 'supabase', 'functions', 'verify-gcash-receipt', 'index.ts'),
  'utf8',
);
const paymentWebhook = fs.readFileSync(
  path.join(root, 'supabase', 'functions', 'payment-webhook', 'index.ts'),
  'utf8',
);

test('receipt analysis always routes new submissions to owner review', () => {
  const decisionStart = verifier.indexOf('// ── decision routing');
  const decisionEnd = verifier.indexOf('const extracted =', decisionStart);
  const decision = verifier.slice(decisionStart, decisionEnd);
  assert.ok(decisionStart >= 0 && decisionEnd > decisionStart);
  assert.match(decision, /result = "manual_review";/);
  assert.doesNotMatch(decision, /result = "(?:auto_approved|rejected)";/);

  const persistStart = verifier.indexOf('const statusUpdate: Record<string, unknown>');
  const persistEnd = verifier.indexOf('const metadataUpdate:', persistStart);
  const persistence = verifier.slice(persistStart, persistEnd);
  assert.match(persistence, /payment_status: "for_verification"/);
  assert.match(persistence, /statusUpdate\.status = "pending"/);
  assert.doesNotMatch(persistence, /statusUpdate\.status = "(?:confirmed|cancelled)"/);
});

test('customer receipt flows defensively stay pending', () => {
  assert.equal(
    (index.match(/const status = 'manual_review';/g) || []).length,
    3,
    'court booking, host session, and open-play receipt helpers must all ignore legacy automatic decisions',
  );
  assert.match(index, /Every[\s\S]*submitted receipt stays pending until the court owner confirms it/);
  assert.match(index, /booking\.status = 'pending';[\s\S]*booking\.paymentStatus = 'for_verification';/);
  assert.doesNotMatch(index, /status:\s*digitalPay \? 'verifying' : 'pending'/);
  assert.doesNotMatch(index, /const status = digitalPay \? 'verifying' : 'pending'/);
  assert.doesNotMatch(index, /Receipt auto-verified\./);
});

test('payment webhooks preserve a pending owner decision', () => {
  const updateStart = paymentWebhook.indexOf('const bookingUpdate: Record<string, unknown>');
  const updateEnd = paymentWebhook.indexOf('if (bookingUpdateErr)', updateStart);
  const bookingUpdate = paymentWebhook.slice(updateStart, updateEnd);
  assert.match(bookingUpdate, /status: "pending"/);
  assert.match(bookingUpdate, /\.in\("status", \["verifying", "pending"\]\)/);
  assert.doesNotMatch(bookingUpdate, /normalized === "failed"[\s\S]*"cancelled"/);
});

test('court owner retains the explicit manual confirmation action', () => {
  const confirmStart = admin.indexOf('async function verifyAndConfirm()');
  const confirmEnd = admin.indexOf('async function resendConfirmationEmail', confirmStart);
  const confirmation = admin.slice(confirmStart, confirmEnd);
  assert.match(confirmation, /updateBookingGroupByRef\(ref, \{ status: 'confirmed', paymentStatus: verifiedPayStatus \}\)/);
});
