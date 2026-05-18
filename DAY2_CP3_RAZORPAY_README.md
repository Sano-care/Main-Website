# Day 2 Checkpoint 3 — Razorpay test-mode integration

Layers on top of Day 1 v2 + Day 2 CP1 + Day 2 CP2 + the Social Links patch.
This checkpoint wires the hero booking flow to Razorpay Checkout in **test mode**, ₹249 partial-prepay, server-side signature verification, booking persisted to Supabase only after a verified payment.

## What this gives you

A real payment funnel. When a visitor submits the hero booking form:

1. Client validates the form.
2. Client POSTs to **`/api/razorpay/create-order`** which creates a Razorpay order for ₹249 (24,900 paise) via the server-side Razorpay SDK.
3. Client opens the **Razorpay Checkout modal** with that order id.
4. Customer pays in the modal (UPI / card / netbanking / wallet — test mode for now).
5. Razorpay returns `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature` to the client.
6. Client POSTs those + the booking details to **`/api/razorpay/verify`**.
7. Server verifies the HMAC-SHA256 signature against the **Key Secret** (we trust the payment only after this).
8. On a valid signature, the server inserts the booking into Supabase with `status = 'CONFIRMED'`, `payment_status = 'CAPTURED'`, and the three Razorpay identifiers stored for audit.
9. Client renders the `BookingConfirmation` component.

If the user dismisses the modal, no booking is created. If the payment fails, no booking is created. If the signature doesn't match, no booking is created. Zero ghost bookings.

## Files in this zip (10 total)

| File | Status | What |
|---|---|---|
| `src/types/razorpay.d.ts` | NEW | TypeScript types for `window.Razorpay` (Checkout JS global) |
| `src/lib/razorpay.ts` | NEW | Server-side Razorpay client wrapper + `verifyPaymentSignature()` + paise constants |
| `src/app/api/razorpay/create-order/route.ts` | NEW | POST endpoint — creates an order for the partial-prepay amount |
| `src/app/api/razorpay/verify/route.ts` | NEW | POST endpoint — verifies the signature and persists the booking |
| `src/hooks/useRazorpayCheckout.ts` | NEW | Client hook that wraps `window.Razorpay` as a Promise |
| `src/hooks/useBookingSubmit.ts` | UPDATED | Was direct-to-Supabase; now: create order → checkout → verify → persist |
| `src/app/layout.tsx` | UPDATED | Loads `https://checkout.razorpay.com/v1/checkout.js` via `next/script` with `lazyOnload` |
| `supabase/migrations/007_razorpay_payments.sql` | NEW | Adds `razorpay_*` columns, `payment_status`, `booking_fee_paid_paise`, `refund_*` to `bookings` |
| `.env.local.example` | NEW | Template for all env vars including the two new Razorpay ones |
| `package.json` | UPDATED | Adds `razorpay ^2.9.7` to dependencies |

## How to deploy

```bash
# 1. Drop the zip over your local Main-Website repo
unzip ~/Downloads/Sanocare_Day2_CP3_Razorpay.zip
# overwrite when prompted

# 2. Install the new server SDK
npm install

# 3. Set up env vars locally for dev
cp .env.local.example .env.local
# Edit .env.local — paste your real test key and secret + Supabase values

# 4. Run the Supabase migration
# In Supabase dashboard → SQL Editor → paste the contents of
# supabase/migrations/007_razorpay_payments.sql → Run

# 5. Run locally
npm run dev
# open http://localhost:3000, fill the hero form, click "Pay ₹249 to confirm"
# Use Razorpay test UPI: success@razorpay  |  test card: 4111 1111 1111 1111 / CVV any / exp any future date
```

## How to deploy to Netlify

In Netlify → Site → Environment variables, add **all four** of these (one per row):

| Key | Value | Where |
|---|---|---|
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | `rzp_test_…` | The Test Key ID — public, exposed to browser |
| `RAZORPAY_KEY_SECRET` | (test key secret) | Server-side only, never exposed |
| `NEXT_PUBLIC_SUPABASE_URL` | already there | (should already exist) |
| `SUPABASE_SERVICE_ROLE_KEY` | (Supabase service role key) | Server-side only — required by `/api/razorpay/verify` to bypass RLS when inserting bookings |

Trigger a new deploy. Try the booking flow against `https://your-site.netlify.app/`. Razorpay test mode uses fake money, so this is safe.

## Test-mode credentials (Razorpay docs)

- **UPI ID:** `success@razorpay` (success) or `failure@razorpay` (failure)
- **Card:** `4111 1111 1111 1111`, CVV any 3 digits, expiry any future month/year, OTP `1234`
- **Netbanking:** any test bank in the dropdown
- All test transactions are visible in your Razorpay dashboard → Transactions → Test mode

## Security notes

1. **`RAZORPAY_KEY_SECRET` is never exposed to the browser.** It's used only inside `src/lib/razorpay.ts` (server-side) and `route.ts` files (Next.js API routes, server-only).
2. **Signature verification is mandatory.** Without server-side signature verification, a malicious client could forge a `payment_id` and trick us into recording a "paid" booking. We compute HMAC-SHA256 with the secret on every callback.
3. **`SUPABASE_SERVICE_ROLE_KEY` is used in `/api/razorpay/verify`** to insert the booking + payment data. This bypasses RLS; we accept that trade-off because the signature has already been verified at that point.
4. **No PII in client-side JS.** Patient name and phone are in client state during the flow, sent to our server during create-order/verify, but never exposed in URLs or logs.

## What's NOT in this checkpoint (Day 3 follow-on)

- **Refund endpoint** (`POST /api/razorpay/refund`) for the "refund before medic dispatch" rule. We'll add this to admin tools.
- **Webhook handler** (`POST /api/razorpay/webhook`) so Razorpay can tell us asynchronously about payment status changes, refunds, disputes. Currently we rely only on the synchronous client callback.
- **Full prepay toggle** — the "Pay ₹499 upfront" option in the booking form. Plumbing is already in place (the API accepts `payFull: true`); the UI toggle hasn't been added yet.
- **Live mode swap.** When your KYC clears, swap the test key ID/secret for the live ones in Netlify env vars; everything else stays the same. Restart deploy. Done.

## Testing checklist

After deploying:

- [ ] Hero booking form submits → Razorpay modal opens
- [ ] Pay with `success@razorpay` UPI → modal closes → BookingConfirmation renders
- [ ] Verify the booking appears in Supabase `bookings` table with `status = 'CONFIRMED'` and a `razorpay_payment_id` set
- [ ] Pay with `failure@razorpay` UPI → friendly error shown, no booking created
- [ ] Dismiss the modal → "Payment cancelled" error, no booking created
- [ ] Tamper with the signature client-side (browser devtools) → server returns 400, no booking created
- [ ] All transactions visible in Razorpay dashboard → Test mode

If any of these fail, send me the error message + the network tab response for the failing endpoint; I'll patch.
