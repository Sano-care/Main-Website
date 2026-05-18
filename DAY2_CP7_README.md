# Day 2 Checkpoint 7 — Lab-test basket + coupon system

Layers on top of all prior checkpoints (Day 1 v2 + CP1 + CP2 + Social patch + CP3 + CP4 + CP5 + CP6).

## What this gives you

- **Multi-test basket** on `/lab-tests`. Patient searches and adds tests one at a time → they stack in a basket panel → subtotal displays live → patient applies a coupon → patient hits *Proceed to book collection* → existing booking modal opens with all selected tests + coupon attached.
- **Coupon system** with percentage discounts, optional minimum-basket thresholds, optional max-discount caps, optional date windows, and optional usage limits. Three coupons seeded in the migration:
  - **`LAUNCH10`** — 10% off any basket, valid 60 days, first 200 redemptions
  - **`FAMILY15`** — 15% off baskets above ₹1,500, valid 90 days, first 100 redemptions
  - **`DELHI20`** — 20% off (max ₹800 off), valid 30 days, first 50 redemptions
- **Discount flows all the way to payment.** The Razorpay order created at *send-report-payment-link* uses the discounted total. The `/reports/[token]` magic-link page displays the original subtotal, the coupon line, the discount amount, and the final payable.
- **Server-side validation** prevents client-side coupon tampering. `/api/lab/validate-coupon` re-verifies on each apply, and the send-report-payment-link endpoint re-reads the locked discount snapshot.

## Files in this zip (12 total)

| File | Status | What |
|---|---|---|
| `supabase/migrations/009_lab_coupons.sql` | **NEW** | `lab_coupons` table + 3 seed coupons + new columns on `bookings`: `applied_coupon_code`, `coupon_discount_percent`, `coupon_discount_paise`, `final_amount_paise`. Idempotent. |
| `src/types/lab-coupon.ts` | **NEW** | TypeScript types: `LabCoupon`, `AppliedCoupon`. |
| `src/app/api/lab/validate-coupon/route.ts` | **NEW** | Validates a coupon code + subtotal pair. Checks active flag, date window, min-basket, usage cap, computes discount + final, returns to client. |
| `src/components/lab/LabTestBasket.tsx` | **NEW** | Sticky right-rail panel (desktop) + floating bottom drawer (mobile). Lists tests, accepts coupon code, shows discount + final, has *Proceed to book collection* CTA. |
| `src/store/bookingStore.ts` | UPDATED | Adds `appliedCoupon: AppliedCoupon \| null` state + `setAppliedCoupon` / `clearAppliedCoupon` actions. Basket mutations auto-clear the coupon (forces re-apply on basket change — prevents stale discount on revised basket). |
| `src/hooks/useBookingSubmit.ts` | UPDATED | Lab booking branch now persists `applied_coupon_code`, `coupon_discount_percent`, `coupon_discount_paise`, `final_amount_paise` on the booking row. |
| `src/components/lab/LabTestSearch.tsx` | UPDATED | "Book this test at home →" replaced with "Add to basket →". Doesn't open the booking modal anymore — basket panel handles the final CTA. Shows "Already in basket ✓" when the test is already added. |
| `src/app/lab-tests/page.tsx` | UPDATED | Layout reflows to `1fr_360px` grid on desktop with the basket as right-rail; mobile gets the floating drawer. |
| `src/app/api/lab/send-report-payment-link/route.ts` | UPDATED | Uses `final_amount_paise` from the booking (the discounted amount) when creating the Razorpay order. Increments `lab_coupons.used_count` at link-send time (so unpaid bookings don't burn a use). |
| `src/app/reports/[token]/page.tsx` | UPDATED | Shows subtotal + coupon line + discount + final on the report page. Pay-button amount = final, not subtotal. |
| `DAY2_CP7_README.md` | **NEW** | This file |

## Test it end-to-end (after applying)

```bash
# 1. Apply zip + npm run dev
# 2. Run migration in Supabase SQL Editor
#    Open supabase/migrations/009_lab_coupons.sql, paste into Supabase Studio, Run.
#    (The 3 seed coupons populate automatically.)

# 3. Open http://localhost:3000/lab-tests
# 4. Search "vitamin d" → click result → click "Add to basket →"
# 5. Search "thyroid" → click result → click "Add to basket →"
# 6. See basket on the right with both tests + subtotal
# 7. Type LAUNCH10 in the coupon field → click Apply
# 8. See 10% discount applied + final reduced by 10%
# 9. Try a higher-value basket + FAMILY15 → confirms min-basket logic works
#    (FAMILY15 requires basket > ₹1,500)
# 10. Click Proceed to book collection → booking modal opens
# 11. Fill name/phone/address → submit
# 12. Supabase bookings row should have:
#       selected_tests = [{vitamin d}, {thyroid}]
#       applied_coupon_code = "LAUNCH10"
#       coupon_discount_percent = 10
#       coupon_discount_paise = <10% of subtotal>
#       final_amount_paise = <subtotal - discount>
#       report_payment_status = "NOT_DUE"
# 13. Simulate ops: upload a dummy PDF + POST /api/lab/send-report-payment-link
#     The Razorpay order amount = final_amount_paise (not subtotal).
# 14. Open the returned /reports/<token> link → see subtotal + coupon + final
#     in the breakdown → pay → report unlocks.
```

## Mobile experience

On screens < 768px the right-rail basket hides. Instead:

- A floating coral pill appears at `bottom: 80px right: 16px` once the basket has at least one test. Pill shows: `🛍 N tests · ₹Final`
- Tapping the pill opens a bottom-up drawer with the full basket contents + coupon input + Proceed CTA.
- Drawer slides closed when patient taps backdrop, the X button, or completes the Proceed action.

## Security notes

- **Coupon validation always happens server-side.** Client-side state is *display only*; the server re-reads coupon rules in `/api/lab/validate-coupon` and again in `/api/lab/send-report-payment-link` before minting the Razorpay order.
- **Stored discount snapshot.** Once a booking is created, the coupon discount is frozen in `bookings.coupon_discount_paise` and `final_amount_paise`. Changing or disabling the coupon afterward doesn't affect the booking — the patient gets the rate they were promised.
- **Used-count increment** happens at *send-report-payment-link* time, not at booking time. A patient who never gets to the report-payment stage (case cancelled, sample rejected) doesn't permanently consume a coupon use.
- **100%-off coupons** would create a ₹0 Razorpay order, which Razorpay rejects. We clamp the minimum to ₹1 (100 paise) — effectively a token capture. If you ever want a true zero-payment flow, the alternative is to mark `report_payment_status = CAPTURED` directly without Razorpay involvement. For v1 the clamp is simpler.

## What's NOT in this checkpoint

- **Admin UI for coupons** in `/ops/lab` or `/cms-admin`. For now, manage coupons via Supabase Studio: insert / update rows in `lab_coupons`. Flip `is_active = false` to disable instantly.
- **Per-customer coupon limits** (e.g., "one use per phone number"). Add a `coupon_usages` join table later if needed.
- **Coupon stacking** (multiple codes at once). Out of scope; single coupon per basket.
- **Referral codes**. Out of scope; could be layered as a special coupon type later.
- **Coupon analytics dashboard.** Use the existing `used_count` column + Supabase BI for now.
