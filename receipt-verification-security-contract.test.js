const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = __dirname;
const verifierPath = path.join(
  root,
  'supabase',
  'functions',
  'verify-gcash-receipt',
  'index.ts',
);
const migrationName = '20260717143000_receipt_verification_rate_limit.sql';
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName);
const verifier = fs.readFileSync(verifierPath, 'utf8');
const migration = fs.readFileSync(migrationPath, 'utf8');
const compactMigration = migration.replace(/\s+/g, ' ');

test('Google Vision credentials are sent in a header, never in the URL', () => {
  assert.match(verifier, /"https:\/\/vision\.googleapis\.com\/v1\/images:annotate"/);
  assert.match(verifier, /"x-goog-api-key": apiKey/);
  assert.doesNotMatch(verifier, /images:annotate\?key=/);
});
test('an authorized receipt attempt is atomically claimed before storage and OCR', () => {
  const claim = verifier.indexOf('attemptClaim = await claimReceiptAttempt(db, receiptAttemptKey)');
  const upload = verifier.indexOf('.from("receipts").upload(', claim);
  const ocr = verifier.indexOf('const ocr = await runOCR(', claim);
  assert.ok(claim >= 0, 'receipt attempt claim must be present');
  assert.ok(upload > claim, 'rate-limit claim must precede receipt storage');
  assert.ok(ocr > upload, 'rate-limit claim must precede the billable OCR call');
  assert.match(verifier, /code: "RECEIPT_RATE_LIMITED"/);
  assert.match(verifier, /}, 429, \{ "Retry-After": String\(retryAfterSeconds\) \}\)/);
  assert.match(verifier, /code: "RECEIPT_LIMITER_UNAVAILABLE"/);
});

test('a failed final database write cannot be reported as auto-approved', () => {
  assert.match(
    verifier,
    /if \(finalUpdateError\) \{[\s\S]*?flags\.push\("FINAL_STATE_PERSISTENCE_FAILED"\)[\s\S]*?result = "manual_review";/,
  );
  assert.match(
    verifier,
    /manual-review persistence fallback failed/,
  );
  assert.doesNotMatch(verifier, /warning: `booking update failed:/);
});

test('receipt limiter uses an atomic service-role-only database claim', () => {
  assert.match(
    compactMigration,
    /create table if not exists public\.receipt_verification_attempts \(/i,
  );
  assert.match(migration, /alter table public\.receipt_verification_attempts enable row level security;/i);
  assert.match(migration, /pg_advisory_xact_lock\(/i);
  assert.match(
    compactMigration,
    /where booking_ref = v_booking_ref and created_at > v_now - make_interval\(secs => p_window_seconds\)/i,
  );
  assert.match(
    compactMigration,
    /revoke all on function public\.claim_receipt_verification_attempt\(text, integer, integer\) from public, anon, authenticated;/i,
  );
  assert.match(
    compactMigration,
    /grant execute on function public\.claim_receipt_verification_attempt\(text, integer, integer\) to service_role;/i,
  );
  assert.doesNotMatch(
    compactMigration,
    /grant execute on function public\.claim_receipt_verification_attempt[^;]+to (?:anon|authenticated)/i,
  );
});

test('fresh database builds include the receipt limiter migration', () => {
  const builder = fs.readFileSync(
    path.join(root, 'tools', 'build-fresh-database-bundle.ps1'),
    'utf8',
  );
  assert.match(builder, new RegExp(migrationName.replaceAll('.', '\\.')));
});
