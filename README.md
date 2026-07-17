# D'fortees Pickleball Court Booking

This repository is the isolated, single-venue booking system for D'fortees
Pickleball Court in Montevista. It uses its own Supabase project and its own
Cloudflare Pages site. It is not a multi-tenant platform and it does not reuse
another venue's database, users, credentials, bookings, GitHub integration, or
deployment configuration.

## Venue identity and live configuration

- Venue: D'fortees Pickleball Court
- Address: Prk-4 National Highway, 8801 Montevista
- Timezone: `Asia/Manila`

Court rates, operating hours, booking fees, payment methods, merchant details,
QR images, Open Play configuration, blocked dates, and court availability are
live operational settings stored in Supabase. Values saved through the admin
system are authoritative and must be preserved across every code, UI, function,
and Cloudflare update. Source-code seed values are for the first installation of
a new empty project only; they must never be reapplied to the live database.

The fresh database seed contains no demo bookings, fake transactions,
placeholder courts, or test accounts.

## Architecture and security

- `supabase/` is the canonical single-tenant database and Edge Function source.
- `single-tenant-api.js` connects the existing user interface to secured
  Supabase database functions.
- Public visitors receive only sanitized venue and availability data. They
  cannot query or insert booking rows directly.
- Guest booking creation is server-priced, idempotent, and protected by atomic
  slot locks. Status, updates, and cancellation require the booking's private
  guest access token.
- Row Level Security is enabled on application tables. Dashboard access requires
  both a Supabase Auth identity and an active row in `public.accounts`.
- `/runtime-config.js` exposes only the public Supabase URL and publishable key.
  Database passwords, service-role keys, access tokens, and provider secrets
  must never be placed in browser code or committed files.

## Local setup

Use Node.js 20 or newer.

```powershell
npm install
Copy-Item .env.local.example .env.local
npm run dev
```

Fill these two public values in the ignored `.env.local` before starting the
server:

```dotenv
PB_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
PB_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
```

Open `http://127.0.0.1:4173/?remoteData=1`. The `remoteData=1` flag forces the
page to use the configured Supabase backend instead of browser demo data.

Without valid public values, the local server deliberately returns the disabled
`dfortees-backend.invalid` configuration. Never put a service-role key in
`.env.local` for the web application.

## Fresh database setup

The database has already been created for D'fortees. The following process is
only for rebuilding a brand-new, empty D'fortees project:

```powershell
powershell -ExecutionPolicy Bypass -File tools/build-fresh-database-bundle.ps1 `
  -SupabaseProjectUrl "https://YOUR_PROJECT_REF.supabase.co"
```

Review and apply `.generated/dfortees-fresh-database.sql` to that empty project.
The generated SQL contains an executable guard that aborts when D'fortees
application tables already exist. Never remove or bypass that guard, and never
apply the bundle to another venue or an existing production database.
The removed `setup-db.js` and `create-accounts.js` scripts are obsolete and must
not be restored or used.

Create dashboard users through Supabase Authentication invitations. After the
user accepts the invitation, link the Auth UUID to an active `public.accounts`
row with the minimum required role. In this application, `owner` means the
system administrator; use `court_owner`, `staff`, or `host` only when
that access is intentionally delegated.

## Verification

Run all checks before a commit or deployment:

```powershell
npm run check
npm test
npm run verify
npm run build:pages
```

The verification command checks JavaScript syntax, automated contracts, Edge
Function types when Deno is available, runtime assets, legacy brand references,
possible committed secrets, and the expected Git remote.

## Deployment

Normal updates are data-preserving. Do not run the fresh database bundle or
historical repair migrations during a website or Edge Function deployment.
Before and after any intentional database migration, snapshot and compare the
live `settings`, `courts`, `accounts`, and booking record counts. New migrations
must be additive unless the user explicitly requests a particular data change.

- Edge Functions: use `deploy-edge-functions.ps1`, which is locked to the
  isolated D'fortees project and deploys only the reviewed allowlist documented
  in `PAYMENT_SETUP.md`.
- Cloudflare Pages: use `deploy-cloudflare-pages.ps1` only after local and
  staging verification. It requires an explicit D'fortees Pages project and
  refuses an accidental legacy target.
- A Free Supabase plan is suitable for development and light use. Before relying
  on it for production bookings, review current plan limits, inactivity
  behavior, backups, recovery requirements, and expected traffic. An upgrade is
  an operational decision, not a requirement for local testing.

Do not connect Supabase's GitHub integration. Repository deployment and database
administration remain separate so a source-code change cannot automatically
alter the booking database.
