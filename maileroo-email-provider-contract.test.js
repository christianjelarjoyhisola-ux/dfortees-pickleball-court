const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = __dirname;

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const providerPath = "supabase/functions/_shared/email-provider.ts";
const activeEmailFunctions = [
  "supabase/functions/send-confirmation-email/index.ts",
  "supabase/functions/send-reschedule-email/index.ts",
  "supabase/functions/process-host-balance-deadlines/index.ts",
];

test("shared email provider uses Maileroo's authenticated v2 endpoint", () => {
  const source = read(providerPath);

  assert.match(source, /https:\/\/smtp\.maileroo\.com\/api\/v2\/emails/);
  assert.match(source, /"X-Api-Key": config\.apiKey/);
  assert.doesNotMatch(source, /apiKey\s*[+}`]|[?&](?:api_?key|key)=/i);
  assert.match(source, /from:\s*\{ address: config\.fromAddress, display_name: config\.fromName \}/);
  assert.match(source, /to:\s*\[\{ address: recipient \}\]/);
  assert.match(source, /result\.data\?\.reference_id/);
});

test("Maileroo configuration is explicit and keeps secrets server-side", () => {
  const source = read(providerPath);

  assert.match(source, /Deno\.env\.get\(name\)/);
  for (const variable of ["EMAIL_PROVIDER", "MAILEROO_API_KEY", "MAILEROO_FROM_EMAIL"]) {
    assert.match(source, new RegExp(`requiredEnv\\(\\"${variable}\\"\\)`));
  }
  assert.match(source, /Deno\.env\.get\("MAILEROO_FROM_NAME"\)/);

  assert.match(source, /provider !== "maileroo"/);
  assert.doesNotMatch(source, /console\.(?:log|info|debug).*apiKey/i);
});

test("every active booking email function uses the shared adapter", () => {
  for (const relativePath of activeEmailFunctions) {
    const source = read(relativePath);
    assert.match(source, /from "\.\.\/_shared\/email-provider\.ts"/);
    assert.match(source, /assertEmailProviderConfigured\(\)/);
    assert.match(source, /await sendTransactionalEmail\(\{/);
  }

  const combined = activeEmailFunctions.map(read).join("\n");
  assert.doesNotMatch(combined, /RESEND_API_KEY|api\.resend\.com|onboarding@resend\.dev/);
});

test("delivery references are preserved for confirmation and balance notices", () => {
  const confirmation = read(activeEmailFunctions[0]);
  const balanceNotices = read(activeEmailFunctions[2]);

  assert.match(confirmation, /confirmation_email_id:\s*delivery\.id/);
  assert.match(confirmation, /provider:\s*delivery\.provider/);
  assert.match(balanceNotices, /provider_message_id:\s*delivery\.id/);
});

test("deployment documentation blocks a Maileroo sandbox production cutover", () => {
  const setup = read("PAYMENT_SETUP.md");
  const envExample = read(".env.example");

  assert.match(setup, /verified Maileroo domain/i);
  assert.match(setup, /sandbox is only for authorized test recipients/i);
  assert.match(envExample, /EMAIL_PROVIDER=maileroo/);
  assert.match(envExample, /MAILEROO_API_KEY=/);
  assert.doesNotMatch(`${setup}\n${envExample}`, /RESEND_API_KEY|api\.resend\.com/);
});
