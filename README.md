# D'fortees Pickleball Court Booking System

An isolated, rebranded court-booking system for D'fortees Pickleball Court. It includes public court booking, Open Play, host accounts, payment review, receipt verification, administrative reporting, and court-owner operations.

## Isolation guarantee

- This repository has a fresh Git history and no remote by default.
- The frontend contains no working Supabase URL or key.
- When the backend is not configured, outbound database requests are blocked and local demo data is used automatically.
- Deployment scripts require `DEPLOYMENT_BRAND=dfortees` and reject missing or legacy targets.
- The read-only source snapshot is excluded from Git and deployment.

## Local preview

Serve the repository with any static web server. For example:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Then open `http://127.0.0.1:4173/`. Local demo mode stores temporary data in that browser only and never contacts Supabase.

Demo owner credentials for testing the login screen:

- Email: `owner@dfortees.local`
- Password: `dev123`

These demo credentials are ignored as soon as a real D'fortees backend is configured.

## Verification

```powershell
npm run verify
```

Verification checks JavaScript syntax, booking-balance behavior, missing local assets, legacy Korte identifiers, live Supabase URLs, JWT-shaped keys, and Git remotes.

## New Supabase project

Never reuse an existing court's project. Create a new D'fortees Supabase project, then generate the reviewed fresh-install SQL bundle:

```powershell
powershell -ExecutionPolicy Bypass -File tools/build-fresh-database-bundle.ps1 `
  -SupabaseProjectUrl https://YOUR-NEW-PROJECT.supabase.co
```

Review `.generated/dfortees-fresh-database.sql`, apply it only to the empty D'fortees project, and verify RLS with anon, host, staff, court-owner, and owner accounts before production use.

Replace the two disabled constants at the top of `supabase-config.js` only with the new D'fortees Project URL and browser publishable key. Server, payment, email, OCR, and notification secrets belong in Supabase Edge Function secrets—not in source code.

## Deployment

For Cloudflare Pages Git deployments, use `npm run build:pages` as the build command and `dist` as the output directory. The build includes only public runtime assets.

Copy `.env.example` to `.env.local` and fill it with D'fortees-only targets. A production deployment requires the new D'fortees backend. A temporary browser-only demo may be deployed explicitly with `powershell -ExecutionPolicy Bypass -File deploy-cloudflare-pages.ps1 -AllowDemoMode`; visitor data then stays only in each browser. Database migrations are never pushed automatically; `deploy-edge-functions.ps1 -ApplyMigrations` must be chosen explicitly.

Do not publish `SETUP_NEW_SUPABASE.sql`, setup scripts, documentation, source snapshots, or local credentials. The Cloudflare deployment script packages only the runtime files.
