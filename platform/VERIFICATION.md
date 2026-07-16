# Development verification

Project: `court-booking-platform-dev` (`ekldjeskfddtzznamkxh`)

Verified against the empty Singapore development project on 2026-07-16:

- one D’fortees tenant, one outdoor court, and the ₱60/₱90 rate rules;
- zero seeded bookings, payments, Open Play sessions, or demo accounts;
- RLS enabled on every application table;
- anonymous direct booking/PII access denied;
- authenticated Tenant A staff could read/update only Tenant A, while the
  platform owner could read both temporary tenants;
- public tenant and availability RPCs available;
- same time allowed across two temporary tenants;
- duplicate active slot rejected within one tenant;
- concurrent requests produced one success and one conflict;
- idempotent replay returned the original booking reference;
- guest status required the private access token;
- cancellation released the slot for a new reservation;
- receipt and proof buckets are private.
- the connected local customer UI loaded one court and live ₱60/₱90 rates,
  completed a guest booking, and displayed the server-generated reference;

The temporary tenants, courts, bookings, and slot locks used by the acceptance
checks were deleted. D’fortees was left with zero bookings and payments.
The end-to-end UI booking and its audit PII were also deleted after validation.
