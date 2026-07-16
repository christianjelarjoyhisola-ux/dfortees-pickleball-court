# D’fortees Court Booking Platform

This repository contains the D’fortees frontend plus a clean multi-tenant
Supabase platform designed to serve independently branded pickleball venues.
The first tenant is `dfortees`; additional venues receive their own tenant,
domain, staff, courts, pricing, bookings, payments, files, and Cloudflare site.

## Isolation and safety

- The current frontend defaults to `https://dfortees-backend.invalid` and local
  browser data until `/runtime-config.js` supplies the new public connection.
- The canonical database and Edge Functions live under `platform/supabase/`.
- The historical root `supabase/` directory is legacy reference only. Its
  single-tenant migrations and functions are not deployed by any active script.
- Guest booking uses RPCs; anonymous users cannot query booking rows or PII.
- Database passwords, service-role keys, personal access tokens, and Cloudflare
  tokens belong only in the ignored `.env.local` or provider secret stores.
- GitHub and Supabase GitHub integration are not required.

## Local preview

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:4173/`. With no `.env.local`, this is an isolated browser
demo and makes no Supabase requests. To test the verified development backend,
copy `.env.local.example` to `.env.local` and add only the project’s public URL,
publishable key, and tenant slug. Never put the service-role key in frontend
configuration.

## Canonical platform

The migrations in `platform/supabase/migrations/` create:

- tenants, domains, profiles, platform admins, and tenant memberships;
- tenant-scoped courts, rates, bookings, slot locks, Open Play, payments,
  receipts, remittances, agreements, notifications, and audit records;
- RLS on every application table and private tenant-prefixed storage;
- server-priced, idempotent guest booking with atomic duplicate prevention;
- public tenant/availability RPCs and token-protected guest booking status.

The D’fortees seed contains one outdoor court, ₱60/hour from 6 AM–6 PM and
₱90/hour from 6 PM–midnight. It contains no demo bookings, fake payments,
placeholder courts, or test accounts.

## Verification

```powershell
npm run check
npm test
npm run verify
npm run build:pages
```

Remote acceptance results are recorded in `platform/VERIFICATION.md`.

## Deployment status

The new development project is intentionally not connected to the live
Cloudflare site. The Free project must be upgraded before production bookings;
production also requires final mobile/desktop integration tests, Auth redirect
URLs, and Cloudflare runtime variables.

`deploy-edge-functions.ps1` deploys only the tenant-aware platform functions and
is hard-locked to the isolated development project. The Cloudflare deployment
script blocks the Free development backend unless an explicit development
preview flag is supplied.
