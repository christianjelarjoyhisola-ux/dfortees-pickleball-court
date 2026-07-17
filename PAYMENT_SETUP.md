# D'fortees Payment and Edge Function Setup

## Current payment mode: cash only

D'fortees currently accepts cash at the front desk. The database baseline keeps
these settings:

- `payment_method_cash = 1`
- `payment_method_gcash = 0`
- `payment_method_bdopay = 0`
- `payment_method_maya = 0`
- `payment_method_bpi = 0`
- `payment_method_gotyme = 0`
- `payment_method_pnb = 0`
- `gcash_checkout_enabled = 0`

Availability, server-side pricing, slot locking, and guest cash booking are
implemented by secured database functions. The customer does not need a login,
and the core cash flow does not require an Edge Function or payment webhook.
A new cash booking remains unpaid/pending until authorized staff confirms it.

## Reviewed Edge Function allowlist

`deploy-edge-functions.ps1` is locked to the isolated D'fortees Supabase project
and deploys only these reviewed functions:

- `create-payment-session`
- `verify-gcash-receipt`
- `send-confirmation-email`
- `send-reschedule-email`
- `send-telegram-notification`
- `process-host-balance-deadlines`

The payment and receipt functions remain dormant while digital payment methods
are disabled. Email, Telegram, and scheduled balance processing are optional and
must not be enabled until their secrets and authorization paths are configured
and tested.

Do not deploy `payment-webhook`, `integration-status`, `manage-account`, or
`host-application`. They are outside the reviewed deployment allowlist. In
particular, `payment-webhook` does not provide a production-approved,
provider-native PayMongo signature verification path.

## Deploying optional reviewed functions

1. Keep the current cash-only database settings unchanged.
2. Put CLI controls only in the ignored `.env.local`:

   ```dotenv
   SUPABASE_PROJECT_REF=YOUR_DFORTEES_PROJECT_REF
   SUPABASE_ACCESS_TOKEN=YOUR_PERSONAL_ACCESS_TOKEN
   DFORTEES_EDGE_DEPLOYMENT_APPROVED=I_UNDERSTAND
   ```

3. Configure provider secrets in Supabase Edge Function secrets, not in the
   repository or browser runtime. Supabase provides `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` to functions; never expose the latter publicly.
4. Set only the secrets needed by the optional feature being enabled:

   - Email: `RESEND_API_KEY`, `EMAIL_FROM`, and optionally `PUBLIC_LOGO_URL`
   - Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `APP_ADMIN_URL`
   - Scheduled balance processing: `HOST_BALANCE_CRON_SECRET` plus the email
     secrets when email reminders are required
   - Receipt analysis: optionally `GOOGLE_VISION_API_KEY` and Telegram secrets

5. Run the locked deployment script:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\deploy-edge-functions.ps1
   ```

6. Test each deployed function with an authenticated, active dashboard user or
   the required private guest/cron credential. Confirm missing or mismatched
   authorization is rejected.

## Enabling digital payments later

Treat digital payments as a separate production change. Before enabling any
digital method:

1. Select the actual provider and use its official API and webhook signature
   specification.
2. Store provider credentials only as Supabase secrets.
3. Bind payment sessions to server-stored booking data; never trust callback
   amounts, booking references, or status values from query parameters.
4. Implement replay protection, idempotency, timestamp tolerance, constant-time
   signature comparison, and safe retry handling.
5. Test paid, failed, expired, duplicated, reordered, and forged events in a
   provider sandbox.
6. Complete a security review before changing any `payment_method_*` setting to
   enabled.

Until those gates pass, cash-only is the supported and safest configuration.
