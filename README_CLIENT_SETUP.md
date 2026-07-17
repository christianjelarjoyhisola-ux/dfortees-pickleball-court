# D'fortees Release Checklist

This checklist is for the single-tenant D'fortees system. It must not be reused
to point another court's website at the D'fortees database.

## Supabase

1. Confirm the selected project is the isolated `dfortees-booking` project
   before changing schema, Auth, storage, or secrets.
2. Keep the project region in Southeast Asia (Singapore) and the database
   timezone-dependent application setting at `Asia/Manila`.
3. Configure the Supabase Auth Site URL and redirect allowlist for the exact
   staging or production D'fortees hostname. For local testing, allow
   `http://127.0.0.1:4173/**`.
4. Invite dashboard users through Supabase Authentication. Do not use a local
   service-role script to create users or auto-confirm passwords.
5. Verify every authorized user has one active `public.accounts` row whose `id`
   exactly matches the Auth user's UUID. Give each user the minimum required
   role: `owner`, `court_owner`, `staff`, or `host`.
6. Keep receipt and proof buckets private. Do not make booking PII or storage
   objects public.
7. Leave cash enabled and all digital payment methods disabled until a real
   provider integration and provider-native webhook verification have passed a
   separate security review.

## Local and staging verification

1. Copy `.env.local.example` to the ignored `.env.local`.
2. Set `PB_SUPABASE_URL` and `PB_SUPABASE_PUBLISHABLE_KEY` as the only values
   returned to the browser. Keep service-role keys and any CLI-only personal
   access token out of frontend runtime configuration.
3. Run:

   ```powershell
   npm run check
   npm test
   npm run verify
   npm run build:pages
   ```

4. Start `npm run dev` and test
   `http://127.0.0.1:4173/?remoteData=1` on mobile and desktop.
5. Verify the public flow: the one D'fortees court appears, rates change at
   6:00 PM, unavailable slots cannot be selected, a cash booking is created once,
   and the private booking token is required for status or cancellation.
6. Verify dashboard login, booking confirmation, cancellation, court and rate
   management, blocked dates, and logout with each intended role.
7. Remove any test bookings and confirm no test accounts, fake payments, or
   placeholder courts remain.

## Edge Functions and Cloudflare

1. Core cash booking works through secured database functions; it does not
   require a payment webhook.
2. If optional notifications or receipt verification are needed, configure only
   their provider secrets in Supabase and deploy through
   `deploy-edge-functions.ps1`. Do not deploy functions manually from the whole
   `supabase/functions` directory.
3. Set Cloudflare runtime values to the public Supabase URL and publishable key.
   Never place a database password or service-role key in Cloudflare browser
   runtime configuration.
4. Deploy to a staging branch first, complete the mobile and desktop acceptance
   test, then switch the intended D'fortees production site.
5. Before accepting real bookings, decide whether the current Supabase plan's
   limits, backup options, recovery process, and operational guarantees match
   the venue's needs.

## Final isolation check

- No other venue URL, key, project reference, booking, account, or branding is
  present in the runtime bundle.
- No Supabase service-role key, database password, provider secret, Cloudflare
  token, or personal access token is tracked by Git.
- The Git remote and Cloudflare project both belong to D'fortees.
- Supabase GitHub integration remains disconnected.
