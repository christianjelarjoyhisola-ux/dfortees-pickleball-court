# D'fortees Production Setup Checklist

1. Create a brand-new D'fortees Supabase project. Never reuse another venue's project.
2. Generate and review the fresh database bundle with `tools/build-fresh-database-bundle.ps1 -SupabaseProjectUrl https://YOUR-NEW-PROJECT.supabase.co`.
3. Apply the bundle only to the empty D'fortees project and verify all RLS roles.
4. Create new owner, court-owner, staff, and host accounts.
5. Configure `supabase-config.js` with only the new Project URL and browser publishable key.
6. Set backend secrets in Supabase Edge Function secret storage; never commit them.
7. Configure D'fortees court names, operating hours, rates, policies, payment accounts, contact details, and photos in the admin dashboard.
8. Test bookings and payments in a staging environment.
9. Create a new D'fortees Cloudflare Pages project and domain.
10. Complete `.env.local` from `.env.example`, run `npm run verify`, and deploy only after every check passes.

The deployment scripts stop before contacting an external service if the D'fortees safety marker or target project is missing. The Cloudflare script permits a backend-free browser-only demo only when `-AllowDemoMode` is supplied explicitly.
