# Multi-tenant production checklist

1. Upgrade the Supabase project before accepting real bookings.
2. Accept the first platform-owner invitation and set a strong password.
3. Configure Supabase Auth Site URL and allowed redirect URLs for the intended
   staging domain before testing password recovery or invitation links.
4. Keep the canonical SQL under `platform/supabase/migrations/`; never apply the
   legacy root `supabase/migrations/` chain to this project.
5. Create `.env.local` from `.env.local.example`. Store tokens only in that
   ignored file; frontend runtime configuration contains only public values.
6. Run `npm run check`, `npm test`, `npm run verify`, and `npm run build:pages`.
7. Test tenant owner login, staff isolation, availability, guest booking,
   cancellation, private receipts, and mobile/desktop layouts on staging.
8. Configure each Cloudflare project with its own `PB_TENANT_SLUG`, domain, and
   branding. All sites may share the verified platform URL and publishable key.
9. Keep manual per-tenant payments until a tenant-specific provider integration
   and signed webhook path have passed review.
10. Switch production only after every acceptance gate passes. Never point this
    project or its scripts at Korte infrastructure.
