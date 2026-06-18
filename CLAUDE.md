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

- **Entity:** SANOCARE TECH INNOVATIONS PRIVATE LIMITED. Registered
  office: Basement, 1899/18, Gali No. 18, Govindpuri, Kalkaji, New
  Delhi 110019. Constitution: Private Limited Company.

- **GST registration:** GSTIN `07ABPCS9713B1Z5`. Regular registration
  (not Composition). Effective 07/06/2026. The ENTITY is GST-registered
  (compliance-required for a Pvt Ltd); the SERVICES (clinical healthcare)
  are GST-exempt under the relevant notification, so customer invoices
  carry no tax line. Both facts are true simultaneously.

- **Directors:** Shashwat Arora + Aayushi Shishodia (founder + co-founder).
  Aayushi is NOT an external patient even if her phone +918210508846
  (customer record SAN-C-00006) shows up as a booking — that's her
  co-founder personal/test usage, not a customer outreach situation.
  Same for Shashwat (+919711977782, +919760059900).

- **Contact constants single source of truth** (T90 Slice 2 Step 17,
  2026-06-12) — `src/lib/contact.ts` exports `PHONE_TEL` (E.164 tel-link
  form `+919711977782`), `PHONE_DISPLAY` (spaced display form
  `+91 97119 77782`), `WHATSAPP_DEEPLINK` (`https://wa.me/919711977782`),
  and `SUPPORT_EMAIL` (`contact@sanocare.in` — founder-locked, NOT the
  legacy `hello@`). Every code-side display surface (Navbar, MobileMenu,
  FloatingWhatsApp, MobileStickyBar, QuickBookCard, BookVisitCta,
  /lab-tests, /c/[token], /reports/[token], LabTestSearch, LegalLayout,
  /pulse/(auth)/login, BookingGate + LabBasketWindow + PaymentStep +
  ConfirmStep error strings, useBookingSubmit error strings,
  /pulse/account + /pulse/help, app/layout.tsx JSON-LD, PrescriptionPdf
  footer) imports from here — a phone or email change is one-grep on
  the constants. Skip: API-layer WhatsApp Cloud API/MSG91 routes (the
  digits there are template payload data, not customer-facing display),
  and CMS constant files (`src/constants/cms/*` are content-managed,
  not code).

- **WhatsApp transport — Meta Cloud API direct** (T-Prong-B,
  2026-06-18) — the Rampwin BSP integration is retired. All 6 outbound
  WhatsApp paths (OTP, aarogya_lead_alert, booking_confirmed,
  visit_complete, lab_collection_scheduled, rx_link/rx_document,
  consult_join) now go through `sendTemplateMessage` in
  `src/lib/whatsapp/cloud-api.ts` (Meta Graph v21.0). Per-template
  enable flags renamed RAMPWIN_*_ENABLED → WHATSAPP_*_ENABLED. Template
  names are code constants (no env-var override). OTP channel union
  narrowed: `OtpChannel` is now `"whatsapp" | "sms"` ("rampwin" is
  accepted as a legacy alias by the send-otp routes and silently maps
  to "whatsapp" so any in-flight clients keep working). The
  otp_verifications.channel CHECK constraint still permits 'rampwin'
  (M017) — historical rows stay valid; new writes only use
  'whatsapp' | 'sms'. The aarogya_lead_alert {{5}} format must stay
  byte-identical to the Rampwin original (templates are Meta-approved
  with the same body shape).

- **M046 `customers.email` + `family_members.health_notes`** (T90 Slice
  2 Step 13, applied 2026-06-11) — optional email on customers; free-
  text health notes on family_members. Edited from
  `/pulse/(authed)/profile` via POST `/api/pulse/profile/email`
  (pragmatic regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, 254-char cap, self-
  only) and POST `/api/pulse/profile/health-notes` (target-aware: body
  `{ target: 'self' | { kind: 'member', memberId }, health_notes }`,
  500-char cap, empty/whitespace → NULL, PGRST116 → 404). The
  `FamilyMember.health_notes` field stays optional (`string | null |
  undefined`) on the TS type until Supabase typegen is wired — required
  there would just trust the cast without enforcing SELECT-column
  coverage at compile time. Phase 2 follow-up: typegen + flip-and-audit
  every `.from('family_members').select()` site.

- **M047 `customers.pulse_first_signin_at`** (T90 Slice 2 Step 09,
  applied 2026-06-11) — nullable TIMESTAMPTZ stamped by
  `/api/auth/verify-otp` success path the first time a phone signs into
  Pulse, distinguishing "first Pulse signin" from "first customers row
  creation" (rows can pre-exist from booking auto-upsert or ops manual
  entry). The verify-otp response shape includes `is_new_customer:
  boolean` so the client can route to `/pulse/welcome` (onboarding)
  vs `/pulse` (home). Backfill not needed: all existing rows start NULL
  and read as new-to-Pulse on next signin.

- **M048 `customers.health_notes`** (T90 Slice 2 Step 13, applied
  2026-06-11) — symmetric to `family_members.health_notes` so the
  Pulse Profile tab can edit the same field for both viewing-self
  (writes to `customers.health_notes`) and viewing-family-member
  (writes to `family_members.health_notes`). Same 500-char cap +
  empty-→-NULL handling. Both columns share UI in
  `/pulse/(authed)/profile/HealthNotesField.tsx`.

- **`bookings.member_id` population from Pulse** (T90 Slice 2 Step 12,
  2026-06-11) — when the caregiver enters a booking flow from the
  /pulse tile grid or recent-activity tap, `bookingStore.entryPoint`
  flips to `'pulse'` and `bookingStore.pulseEntryMember` records who
  the booking is for (`{ kind: 'self' }` or `{ kind: 'member',
  member }`). The `MemberConfirmStep` (Step 0 of any Pulse-entry flow)
  confirms or switches the target, pre-fills address via GET
  `/api/pulse/booking/address-prefill`, then proceeds to the
  service/lab basket. On submission, `member_id` is threaded through
  both `/api/razorpay/verify` and `/api/lab/create-booking-prepaid`
  INSERTs (NULL on T61 marketing entries). Reset on closeModal /
  closeLabBasket / closeGate / resetForNewBooking. Not persisted —
  `partialize` omits both fields so they don't survive page refresh.

- **Pulse session cookie + stay-signed-in** (T90 Slice 1 Step 04 +
  later) — HMAC-SHA256 signed `sanocare_otp_verify` cookie via
  `src/lib/otp/token.ts`. Two TTL modes driven by the verify-otp
  payload's `stay_signed_in` boolean (default `true`; only `false`
  when the welcome checkbox is unchecked):
    - `stay_signed_in: true`  → 1-year persistent cookie + matching
      token exp + sliding renewal on every `/api/pulse/*` hit
      (`PULSE_LONG_TTL_SECONDS = 365 days`).
    - `stay_signed_in: false` → session cookie (no Max-Age) + short
      `TOKEN_TTL_SECONDS` exp.
  `/api/pulse/signout` clears the cookie with Max-Age=0 and returns
  204. The `PulseSignOutButton` component (three variants:
  `"primary"` pill, `"ghost"` inline, `"menu"` row) wraps this.
  PulseDrawer + PulseAvatarMenu both consume the `"menu"` variant —
  do NOT inline another `fetch + router.push` sign-out path; route
  it through the component so a sign-out tweak (timeout, toast,
  pre-flight) is one-grep.

- **Pulse client-side localStorage keys** — all Pulse keys live under
  the `pulse_*` prefix so a `localStorage.clear()` on /pulse never
  collides with marketing-side state:
    - `pulse_sessions_count` — int. Bumped at most once per UTC day
      by `(authed)/_lib/sessionCount.ts:bumpSessionCount()` (PulseChrome
      effect). Gates the PWA install prompt's `MIN_SESSIONS = 2`.
    - `pulse_sessions_last_bump_at` — ISO date string, the de-dupe
      key for `bumpSessionCount`.
    - `pulse_install_prompt_dismissed_at` — epoch-ms string. 7-day
      cooldown before the PWA install prompt re-shows.
    - `pulse_viewing_member_id:{customer.id}` — the viewing-target
      uuid (or sentinel for "self"). Per-account so a shared device
      with multiple sign-ins keeps each account's last-viewed target.
      Owned by `MemberViewingContext` (`src/app/pulse/_lib/`).

- **"Dispatch + mount = one tree" — booking flow contract** (T90 Slice
  2 Step 11, learned the hard way from a tile-tap dead-end regression)
  — the bookingStore-driven overlays (BookingModal, ServiceLed
  BookingModal, LabBasketWindow, BookingGate) are extracted into a
  single component `src/components/booking/BookingFlowMounts.tsx` that
  subscribes to seven store selectors. ANY tree that dispatches via
  `useBookingFlow()` MUST render `<BookingFlowMounts />` somewhere in
  scope, otherwise the store flips state but no modal is mounted to
  react. Currently rendered in TWO places: `Navbar.tsx` (marketing
  tree) and `PulseChrome.tsx` (Pulse tree). If you add a third root
  (e.g. a future /care or /ops surface) that calls `useBookingFlow`,
  mount BookingFlowMounts there too.

- **Pulse chrome wrapper structure** (T90 Slice 1 Step 05 + Slice 2
  Step 11) — `src/app/pulse/(authed)/layout.tsx` wraps its children
  in `<PulseCustomerProvider customer={customer}>` (server-resolved
  customer record), which then wraps `<PulseChrome>` (client). The
  chrome owns three overlay states (drawer, member-switcher sheet,
  avatar menu) AND mounts `<BookingFlowMounts />`. Around the whole
  chrome: `<MemberViewingProvider>` (from `_lib/MemberViewingContext`)
  for cross-surface viewing state. So the React tree under
  `(authed)/...` reads:
    PulseCustomerProvider
      → MemberViewingProvider
        → PulseDrawer + main(children) + MemberSwitcherSheet +
          PulseAvatarMenu + BookingFlowMounts
  Any new authed Pulse surface gets both customer + viewing context for
  free, plus the booking-flow mount. The hooks are `useCurrentCustomer()`
  and `useViewingMember()` / `useViewingFirstName()`.
