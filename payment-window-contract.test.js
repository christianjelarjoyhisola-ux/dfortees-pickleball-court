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
const schema = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260717130000_single_tenant_security.sql'),
  'utf8',
);

test('customer hold, database hold, receipt verification, and admin evidence all use 15 minutes', () => {
  assert.match(index, /const RESERVATION_MINUTES = 15;/);
  assert.match(index, /15-minute payment window:/);
  assert.match(verifier, /const PAYMENT_WINDOW_MINUTES = 15;/);
  assert.match(verifier, /outside the allowed 15-minute window/);
  assert.doesNotMatch(verifier, /allowed 10-minute window/);
  assert.match(
    verifier,
    /function appendPaymentWindowFlags\([\s\S]*?DATE_UNREADABLE[\s\S]*?TIME_UNREADABLE[\s\S]*?TIME_EXPIRED/,
  );
  assert.equal(
    (verifier.match(/appendPaymentWindowFlags\(/g) || []).length,
    2,
    'payment-window validation must be defined once and applied once to every provider',
  );
  const helperStart = verifier.indexOf('function appendPaymentWindowFlags(');
  const helperEnd = verifier.indexOf('function digitsOnly(', helperStart);
  const helper = verifier.slice(helperStart, helperEnd);
  assert.match(helper, /receiptAgeMinutes < -PAYMENT_EARLY_TOLERANCE_MINUTES/);
  assert.match(helper, /receiptAgeMinutes > PAYMENT_WINDOW_MINUTES/);
  assert.doesNotMatch(
    helper,
    /DATE_NOT_TODAY|receiptDate\s*!==/,
    'elapsed-time validation must allow a valid payment that crosses midnight',
  );
  assert.match(admin, /allowedPaymentWindowMinutes \?\? 15/);
  assert.match(schema, /v_hold_expires := now\(\) \+ interval '15 minutes';/i);
});

test('mobile countdown uses the absolute server expiry and cannot pause in the background', () => {
  assert.match(
    index,
    /function reservationDeadlineMs\([\s\S]*?if \(Number\.isFinite\(expiresMs\)\) return expiresMs;/,
  );
  assert.match(index, /expiresAt: _reservationExpiresAt/);
  assert.match(index, /rows\.map\(row => row\.holdExpiresAt\)/);
  assert.match(index, /reserveResult\?\.holdExpiresAt \|\| reserveFallbackExpiresAt/);
  assert.match(
    index,
    /const started = hasValidExpiry[\s\S]*?expires\.getTime\(\) - RESERVATION_MINUTES \* 60 \* 1000/,
  );

  const countdownStart = index.indexOf('function startSlotCountdown(');
  const countdownEnd = index.indexOf('function stopSlotCountdown(', countdownStart);
  const countdown = index.slice(countdownStart, countdownEnd);
  assert.ok(countdownStart >= 0 && countdownEnd > countdownStart);
  assert.match(countdown, /const serverDeadlineMs = reservationDeadlineMs\(\)/);
  assert.match(countdown, /Math\.ceil\(\(deadlineMs - Date\.now\(\)\) \/ 1000\)/);
  assert.doesNotMatch(countdown, /secsLeft--/);
});
