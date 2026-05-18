# Day 2 Checkpoint 6 — Lab diagnostics backend (pay-after-report flow)

Layers on top of CP1 + CP2 + Social patch + CP3 + CP4 + CP5.

## What this gives you

The end-to-end lab-test home-collection flow:

1. **Patient** searches a test on `/lab-tests` (or the homepage section) → clicks "Book this test at home" → the test is added to the booking store and the booking modal opens with `diagnostics` pre-set.
2. **Patient submits the booking form** → `useBookingSubmit` notices `serviceCategory === "diagnostics"` → **skips Razorpay-at-booking** (lab collection is free) → inserts a booking row in Supabase with status `PENDING_COLLECTION`, the selected tests in `selected_tests` JSONB, and `report_payment_status = NOT_DUE`.
3. **Ops** sees the booking in `/ops/lab` → coordinates with Pathcore (WhatsApp/phone) → moves status through `COLLECTED → AT_LAB → REPORT_READY` manually in Supabase Studio.
4. **When Pathcore returns the report**, ops uploads the PDF to Supabase Storage bucket `lab-reports`, then POSTs to `/api/lab/send-report-payment-link` with the booking id + storage path.
5. **The server** creates a Razorpay order for the locked-in test total, generates a 32-char unlock token, persists everything, returns a link of the form `https://sanocare.in/reports/<token>`.
6. **Ops** sends this link to the patient via WhatsApp/SMS.
7. **Patient** opens the link → sees their tests + total → clicks **"Pay ₹X & view report"** → Razorpay Checkout opens → pays → signature verified server-side → `report_payment_status = CAPTURED` → page refreshes to show a signed 10-minute download URL for the report PDF.

## Files in this zip (8 new + 4 modified = 12 total)

| File | Status | What |
|---|---|---|
| `supabase/migrations/008_lab_diagnostics.sql` | **NEW** | Extends `bookings` with 12 new columns: `selected_tests`, `test_total_paise`, `lab_partner`, `lab_partner_order_id`, `report_url`, `report_uploaded_at`, `report_unlock_token` (UNIQUE), `report_payment_status`, `report_razorpay_order_id`, `report_razorpay_payment_id`, `report_payment_link_sent_at`, `report_paid_at`. Plus 3 new indexes and 6 new status enum values. |
| `src/lib/lab-tokens.ts` | **NEW** | `generateReportUnlockToken()` — 32-char hex from `crypto.randomBytes(16)`. `isValidTokenFormat()` for client/server validation. |
| `src/app/api/lab/send-report-payment-link/route.ts` | **NEW** | Ops-authed (header `x-ops-token`) endpoint. Creates Razorpay order for the test total, generates an unlock token, persists, returns the patient payment link. |
| `src/app/api/razorpay/verify-test-payment/route.ts` | **NEW** | Verifies the signature, marks `report_payment_status = CAPTURED`, mints a signed Supabase Storage URL valid for 10 min, returns the URL to the client. |
| `src/app/reports/[token]/page.tsx` | **NEW** | Server-rendered magic-link viewer. Looks up booking by token, renders patient-friendly UI showing tests + total, paid/unpaid state, embeds the client payment component. |
| `src/app/reports/[token]/ReportPaymentClient.tsx` | **NEW** | Client component — opens Razorpay Checkout when patient clicks pay, hits `/api/razorpay/verify-test-payment`, reveals signed download URL on success. |
| `src/app/ops/lab/page.tsx` | **NEW** | Server-rendered ops dashboard. Lists all `service_category = "diagnostics"` bookings, status counts by stage, full workflow checklist at the bottom. Wired with the service-role key so it bypasses RLS. |
| `src/store/bookingStore.ts` | UPDATED | Adds `selectedTests: SelectedLabTest[]` state + `addSelectedTest` / `removeSelectedTest` / `clearSelectedTests` actions. Persists tests in localStorage with 30-min expiry. |
| `src/hooks/useBookingSubmit.ts` | UPDATED | Branches on `serviceCategory === "diagnostics"`: skips Razorpay, inserts the booking directly into Supabase with `PENDING_COLLECTION` status + selected tests + `lab_partner = "pathcore"`. Standard flow unchanged for home-visit / nursing / teleconsult. |
| `src/components/lab/LabTestSearch.tsx` | UPDATED | "Book this test at home" now calls `addSelectedTest()` to persist the test on the booking store (not just open the modal). |
| `DAY2_CP6_README.md` | **NEW** | This file |

## Env vars to set in Netlify (one new + verify the others)

| Key | Purpose |
|---|---|
| `OPS_API_TOKEN` | **NEW.** Long random string. Required by `/api/lab/send-report-payment-link`. Share with ops team only. Rotate after any handover. |
| `NEXT_PUBLIC_SITE_URL` | (Optional, recommended.) Set to `https://sanocare.in` in production or your Netlify preview URL. Used to construct the patient payment link. Falls back to `https://sanocare.in` if unset. |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | Existing from CP3 (`rzp_test_SplYBg9n3SaUvE` in test mode) |
| `RAZORPAY_KEY_SECRET` | Existing from CP3 |
| `SUPABASE_SERVICE_ROLE_KEY` | Existing |

## One-time Supabase setup

After running migration 008, create the storage bucket:

```sql
-- Run in Supabase SQL Editor (one-time)
insert into storage.buckets (id, name, public)
values ('lab-reports', 'lab-reports', false)
on conflict (id) do nothing;
```

The bucket is **private** — reports are only ever served via the signed URLs minted by `/api/razorpay/verify-test-payment`. No public access.

## How to test end-to-end (test mode)

```bash
# 1. Apply this zip + run npm install if needed
npm run dev
# 2. Visit http://localhost:3000/lab-tests
# 3. Search "vitamin d" → click a result → click "Book this test at home"
# 4. Fill the booking form → click submit
# 5. Booking should appear in Supabase `bookings` table with:
#       service_category = "diagnostics"
#       status = "PENDING_COLLECTION"
#       selected_tests = [{...vitamin d...}]
#       test_total_paise = <amount * 100>
#       report_payment_status = "NOT_DUE"
# 6. Visit http://localhost:3000/ops/lab — see the booking in the list
# 7. Simulate the ops flow:
#    a. In Supabase Studio, edit the row's `status` to "REPORT_READY"
#    b. Upload a dummy PDF to the `lab-reports` bucket, note the path
#    c. Run this curl (substitute values):
#       curl -X POST http://localhost:3000/api/lab/send-report-payment-link \
#         -H "Content-Type: application/json" \
#         -H "x-ops-token: <your OPS_API_TOKEN>" \
#         -d '{"bookingId":"<uuid>", "reportStoragePath":"test/dummy.pdf"}'
#    d. Response contains the patient link: http://localhost:3000/reports/<token>
# 8. Open that URL → see "Pay ₹X & view report" → pay with Razorpay test UPI
#    (success@razorpay) → page reveals the signed download URL → click to
#    download the dummy PDF
```

## What's NOT in this checkpoint

- **Outbound SMS/WhatsApp notification**: The patient payment link is *returned by the API* but isn't yet auto-sent. Ops copies the link from the API response and WhatsApps it manually. We add MSG91 / Twilio / WhatsApp Cloud API integration later (1 day's work).
- **Report PDF upload UI in /ops/lab**: Currently ops uploads the PDF directly into Supabase Storage (via Studio or a CLI), then triggers the API via curl. A proper upload-button + drag-and-drop UI in `/ops/lab` ships in CP7.
- **Webhook on Razorpay refund**: If Pathcore rejects a sample after payment, you'd refund via Razorpay dashboard. The `/api/razorpay/webhook` handler (to sync refund status back to `report_payment_status = REFUNDED`) is also CP7.
- **iOS / Android Pulse integration**: The same data model supports Pulse showing past reports in-app. No changes needed; just hit the same Supabase tables when Pulse Phase 1 ships.

## Architecture decisions worth flagging

- **No Razorpay charge at booking** for lab collection. Patient creates a booking with zero financial commitment; the only payment is for the test cost when the report is back. Minimises refund hassle, aligns with "Free home collection" promise.
- **Single Razorpay order per lab booking** (the test-cost order). The booking-fee `/api/razorpay/create-order` is never called for `serviceCategory = "diagnostics"`.
- **Magic-link reports** instead of building a Patient Portal login for v1. DPDP 2023 friendly because the token is bound to a single booking + revocable by zeroing the column. Replaces with proper auth when Pulse Phase 1 ships.
- **Manual ops via /ops/lab + Supabase Studio.** Deliberately not building an API integration with Pathcore yet — wait until volume + business relationship justify it.
- **Signed URLs (10-min TTL) for the report PDF.** Even after payment, the patient can't permanently share the bare link — they'd have to redirect to /reports/[token] which validates the token+payment again. Stops link sharing leaking reports indefinitely.
