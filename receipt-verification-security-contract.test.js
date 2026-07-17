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
const receiptClientPath = path.join(root, 'supabase-config.js');
const verifier = fs.readFileSync(verifierPath, 'utf8');
const migration = fs.readFileSync(migrationPath, 'utf8');
const receiptClient = fs.readFileSync(receiptClientPath, 'utf8');
const compactMigration = migration.replace(/\s+/g, ' ');

test('Google Vision credentials are sent in a header, never in the URL', () => {
  assert.match(verifier, /"https:\/\/vision\.googleapis\.com\/v1\/images:annotate"/);
  assert.match(verifier, /"x-goog-api-key": apiKey/);
  assert.doesNotMatch(verifier, /images:annotate\?key=/);
});

test('receipt verification prefers the current Supabase secret-key dictionary', () => {
  assert.match(verifier, /Deno\.env\.get\("SUPABASE_SECRET_KEYS"\)/);
  assert.match(verifier, /parsed\.default/);
  assert.match(verifier, /startsWith\("sb_secret_"\)/);
  assert.match(verifier, /const serviceRoleKey = supabaseServerKey\(\)/);
});

test('receipt multipart and Base64 transports use the current session bearer', () => {
  const authHeadersStart = receiptClient.indexOf('async function _authRestHeaders');
  const authHeadersEnd = receiptClient.indexOf('\n}', authHeadersStart) + 2;
  const authHeaders = receiptClient.slice(authHeadersStart, authHeadersEnd);
  assert.ok(authHeadersStart >= 0, 'session-aware REST header helper must exist');
  assert.match(authHeaders, /_sb\.auth\.getSession\(\)/);
  assert.match(authHeaders, /session\?\.access_token/);
  assert.match(
    authHeaders,
    /Authorization: `Bearer \$\{accessToken \|\| SUPABASE_ANON_KEY\}`/,
    'authenticated requests must use the session JWT and guests must fall back to the publishable key',
  );

  const base64Start = receiptClient.indexOf('async function _pbVerifyReceiptBase64Fallback');
  const base64End = receiptClient.indexOf('function _extractFnError', base64Start);
  const base64Transport = receiptClient.slice(base64Start, base64End);
  assert.ok(base64Start >= 0 && base64End > base64Start, 'Base64 receipt transport must exist');
  assert.match(
    base64Transport,
    /headers: await _authRestHeaders\(\{ 'Content-Type': 'application\/json' \}\)/,
  );
  assert.match(base64Transport, /guestAccessToken: payload\.guestAccessToken/);
  assert.doesNotMatch(base64Transport, /Authorization[^\n]+SUPABASE_ANON_KEY/);

  const verifierStart = receiptClient.indexOf('async verifyGcashReceipt(payload)');
  const verifierEnd = receiptClient.indexOf('async getReceiptSignedUrl', verifierStart);
  const browserVerifier = receiptClient.slice(verifierStart, verifierEnd);
  assert.ok(verifierStart >= 0 && verifierEnd > verifierStart, 'browser receipt verifier must exist');
  assert.match(browserVerifier, /form\.append\('guestAccessToken', String\(payload\.guestAccessToken\)\)/);
  assert.match(
    browserVerifier,
    /headers: await _authRestHeaders\(\),\s*body: form/,
    'multipart receipt requests must use the session-aware headers',
  );
  assert.doesNotMatch(browserVerifier, /Authorization[^\n]+SUPABASE_ANON_KEY/);
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

test('booking lookup failures preserve a server-side diagnostic', () => {
  assert.match(verifier, /booking receipt lookup failed:/);
  assert.match(verifier, /return json\(\{ error: "Booking could not be loaded" \}, 500\)/);
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

test('the deployed receipt entrypoint is lightweight and never fabricates prior approval', () => {
  assert.match(verifier, /Deno\.serve\(async \(req\) =>/);
  assert.doesNotMatch(verifier, /Hello \$\{name\}/);
  assert.doesNotMatch(verifier, /imagescript|Image\.decode|dHash\(/i);
  assert.match(verifier, /const phash: string \| null = null;/);
  assert.match(
    verifier,
    /const receiptAlreadyProcessed = hasStoredReceipt &&[\s\S]*?hasCompletedVerification &&[\s\S]*?\["auto_approved", "manual_review", "rejected"\]/,
  );
  assert.match(verifier, /if \(closedWithoutCompletedReceipt\) \{[\s\S]*?}, 409\);/);
});

test('receipt audit must persist before a booking can be finalized', () => {
  const auditInsert = verifier.indexOf('const { error: auditErr } = await db.from("receipt_verifications").insert(');
  const finalStatus = verifier.indexOf('const statusUpdate: Record<string, unknown> = {}');
  assert.ok(auditInsert >= 0, 'audit insertion must exist');
  assert.ok(finalStatus > auditInsert, 'audit insertion must happen before final booking status');
  assert.match(
    verifier,
    /const \{ error: auditErr \} = await db\.from\("receipt_verifications"\)\.insert\(/,
  );
  assert.match(verifier, /receipt verification audit insert failed:/);
  assert.match(
    verifier,
    /if \(auditErr\) \{[\s\S]*?flags\.push\("AUDIT_PERSISTENCE_FAILED"\)[\s\S]*?result = "manual_review";/,
  );
  assert.match(verifier, /receipt_verified_at: receiptVerifiedAt/);
});

test('exact receipt replays are rejected outside the current booking group', () => {
  assert.match(
    verifier,
    /\.eq\("receipt_image_hash", imageHash\)[\s\S]*?!bookingGroupRefs\.has/,
  );
  assert.match(verifier, /if \(duplicateImage\) flags\.push\("DUPLICATE_IMAGE"\)/);
  assert.match(verifier, /"DUPLICATE_IMAGE",/);
});

test('pricing calculation failures route to review, not payment-fraud rejection', () => {
  assert.match(verifier, /flags\.push\("PRICING_UNAVAILABLE"\)/);
  assert.doesNotMatch(
    verifier,
    /if \(pricingError\) flags\.push\("AMOUNT_MISMATCH"\)/,
  );
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
