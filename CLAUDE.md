# CLAUDE.md

Project context for Claude Code sessions on the Sanocare Main-Website
repo. Lives in-repo so every session sees the same source-of-truth.

## Domain facts that bite if you forget them

- `family_members` table (M042) — one-to-many under `customers`, hard
  cap 8 enforced via BEFORE INSERT trigger. NO RLS policies (matches
  M035/M036 precedent — ownership enforced in API layer via
  `getCurrentCustomer()`). "Self" is virtual: `bookings.member_id =
  NULL` means booking is for account owner. `relation` is a closed
  enum without 'self' — `relation='self'` is invalid by design.
  `relation_other` is non-empty iff `relation='other'`.

- `bookings.member_id` + `bookings.coordination_phone` (M042) —
  nullable additions on existing bookings table. `member_id ON DELETE
  SET NULL` preserves booking history when a member is deleted (the
  denormalised `bookings.patient_name` snapshot stays). `coordination_phone`
  is per-booking optional direct-contact for medic-to-relative
  coordination (not the primary contact path).

- **v0 schema universe retired** (M042 prologue, 2026-06-08) —
  `profiles`, `consultations`, `family_members`, `vitals` tables from
  a May 2026 Supabase-Auth prototype were DROP CASCADE'd. Zero `src/`
  references existed. Current architecture: `customers` (M013) +
  `bookings` (M013) + `consultation_sessions` (M021) +
  `vital_readings` (M035). If you find code or queries referencing the
  v0 names, they're dead — flag for cleanup.

- `validatePatientName` (`src/lib/booking/customerLink.ts`,
  customer-link-hotpatch-v1) — server-side accepts a patient name only
  if length 2–80 AND not in the case-insensitive placeholder list
  (`patient`, `user`, `test`, `name`). Returns 400 on bad input. Used
  by `/api/razorpay/verify` and `/api/lab/create-booking-prepaid`
  before any `bookings.patient_name` write. Client-side validators
  (IdentifyStep, LabBasketWindow) mirror the same rules — keep them
  in sync if you add a placeholder.

- `lookupCustomerIdByPhone` (same module) — soft-fail customer lookup
  by phone. Returns `customer_id` or null when no match. Booking
  routes use this to populate `bookings.customer_id` for known phones.
  Soft-fail = transient DB error returns null and the booking still
  inserts (with `customer_id` NULL) rather than refusing a paid
  booking.

- `customers.full_name` + `customers.customer_code` are NULLABLE
  (M043, 2026-06-09). UNIQUE on `customer_code` permits multiple
  NULLs per Postgres semantics. The auto-upsert path on
  `/api/auth/verify-otp` inserts rows with phone only — both columns
  fill in lazily (patient types name in booking form → name landed in
  customers via PATCH; ops UI assigns `customer_code` on first
  review). If you query customers, do not assume either column is
  non-null.

- `/api/auth/verify-otp` response shape (post-T64 PR1) is
  `{ ok: true, phone, customer_id, full_name }`. `customer_id` is
  auto-upserted for fresh phones. `full_name` is null when the row
  has never captured a name. Clients (`BookingGate.tsx`) seed the
  `bookingStore.verifiedFullName` cache from this; `IdentifyStep` +
  `LabBasketWindow` pre-fill their name input when the cache is
  non-null. Soft-fail throughout — if the customer resolve fails for
  any reason, both fields come back null and the gate still works
  off the cookie.

- M044 backfill (2026-06-09) populated `bookings.customer_id` for all
  historical orphans whose `phone` matched a `customers` row. Going
  forward, the booking-insert paths (post-`customer-link-hotpatch-v1`)
  call `lookupCustomerIdByPhone` so new bookings link automatically.
  Bookings with no matching customer row continue to insert with
  `customer_id = NULL` until the auto-upsert on
  `/api/auth/verify-otp` runs (which happens the first time the
  patient OTPs through the booking gate).
