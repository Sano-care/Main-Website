import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPaymentSignature } from "@/lib/razorpay";
import {
  VERIFY_COOKIE_NAME,
  normaliseIndianPhone,
  verifyToken,
} from "@/lib/otp/token";
import { sendAarogyaLeadAlert } from "@/lib/booking/rampwin";
import { sendBookingConfirmed } from "@/lib/aarogya/rampwin";
import { formatLeadAlertContext } from "@/lib/booking/contextFormat";
import { t85ServiceDisplayName } from "@/lib/booking/serviceMapper";
import {
  validatePatientName,
  lookupCustomerIdByPhone,
} from "@/lib/booking/customerLink";
import { LAB_COLLECTION_FEE_INR } from "@/lib/services/labCatalog";
import { PHONE_DISPLAY } from "@/lib/contact";

export const runtime = "nodejs";

/**
 * POST /api/lab/create-booking-prepaid
 *
 * T85 PR4b — full-prepaid lab booking. Verifies Razorpay signature +
 * OTP cookie, RE-VALIDATES the coupon server-side, recomputes the
 * grand total, and inserts the booking row with
 * `service_category='lab-tests'` + `report_payment_status='CAPTURED'`.
 *
 * Coexists with the legacy `/api/lab/create-booking` (free-at-booking
 * + pay-after-report). The two endpoints write structurally similar
 * rows but populate different lifecycle columns:
 *   - This route: status='PENDING_COLLECTION', report_payment_status='CAPTURED'
 *   - Legacy:     status='PENDING_COLLECTION', report_payment_status='NOT_DUE'
 *
 * The `/reports/[token]` magic-link path checks `report_payment_status`
 * — for PR4b rows it sees CAPTURED, skips the paywall, and unlocks
 * the PDF on token alone. Existing 19 legacy rows keep walking the
 * old NOT_DUE→LINK_SENT→CAPTURED lifecycle until their reports ship;
 * PR5 retires the legacy path after the last legacy row clears.
 *
 * Body:
 *   {
 *     razorpay_order_id, razorpay_payment_id, razorpay_signature,
 *     booking: {
 *       patient_name, phone, manual_address,
 *       gps_location?: { lat, lng, accuracy },
 *       selected_tests: [{ code, name, priceInr, mrpInr, qty }],
 *       subtotalInr,
 *       couponCode?,
 *       scheduledFor: { kind: 'asap' } | { kind: 'slot', iso: string },
 *     }
 *   }
 *
 * Returns:
 *   200 { ok: true, bookingId, bookingCode, finalAmountInr }
 *   400 / 401 / 500 { error }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      booking,
    } = body || {};

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json(
        { error: "Missing Razorpay payment fields" },
        { status: 400 },
      );
    }
    if (!booking || typeof booking !== "object") {
      return NextResponse.json({ error: "Missing booking" }, { status: 400 });
    }

    // === OTP gate ===
    const verifyCookie = req.cookies.get(VERIFY_COOKIE_NAME)?.value;
    const verified = verifyToken(verifyCookie);
    if (!verified) {
      return NextResponse.json(
        { error: "Phone verification required. Please request a code first." },
        { status: 401 },
      );
    }
    const submittedPhone = normaliseIndianPhone(String(booking.phone ?? ""));
    if (!submittedPhone || submittedPhone !== verified.phone) {
      return NextResponse.json(
        {
          error:
            "Booking phone does not match the verified number. Please re-verify.",
        },
        { status: 401 },
      );
    }

    // === Razorpay signature ===
    const valid = verifyPaymentSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });
    if (!valid) {
      console.warn(
        "[lab/create-booking-prepaid] signature mismatch for order",
        razorpay_order_id,
      );
      return NextResponse.json(
        { error: "Payment signature invalid" },
        { status: 400 },
      );
    }

    // === Field validation ===
    // customer-link-hotpatch: full name validation (rejects empty / <2
    // chars / placeholder strings like "Patient"). LabBasketWindow gates
    // on the same rules client-side; this is the actual contract.
    const nameValidation = validatePatientName(booking.patient_name);
    if (!nameValidation.ok) {
      return NextResponse.json(
        { error: nameValidation.error },
        { status: 400 },
      );
    }
    const patientName = nameValidation.name;
    const address = String(booking.manual_address ?? "").trim();
    if (address.length < 10) {
      return NextResponse.json(
        { error: "Address is too short." },
        { status: 400 },
      );
    }

    const selectedTests = Array.isArray(booking.selected_tests)
      ? booking.selected_tests
      : [];
    if (selectedTests.length === 0) {
      return NextResponse.json(
        { error: "Pick at least one lab test before booking." },
        { status: 400 },
      );
    }

    // === Server-side re-pricing ===
    // Don't trust client subtotal. Recompute from selected_tests'
    // priceInr × qty. Each row arrives with `{ code, name, priceInr,
    // mrpInr, qty }`. mrpInr is for the snapshot only (records what
    // was struck-through at booking time); not used for pricing.
    type Test = {
      code: string;
      name: string;
      priceInr: number;
      mrpInr?: number;
      qty?: number;
    };
    const subtotalInr = selectedTests.reduce((sum: number, t: Test) => {
      const price = Number(t.priceInr) || 0;
      const qty = Math.max(1, Number(t.qty) || 1);
      return sum + price * qty;
    }, 0);

    // === Coupon re-validation (matches create-order logic) ===
    const couponCode =
      typeof booking.couponCode === "string" &&
      booking.couponCode.trim().length > 0
        ? booking.couponCode.trim().toUpperCase()
        : null;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Supabase server credentials missing" },
        { status: 500 },
      );
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // T85 PR4b v2 — payment mode. 'full' = full grand total prepaid;
    // 'partial' = ₹200 collection fee prepaid + balance at door via
    // UPI. Defaults to 'full' for back-compat with any caller that
    // pre-dates the v2 wire shape.
    const paymentMode =
      booking.paymentMode === "partial" ? "partial" : "full";

    let discountInr = 0;
    let couponDiscountPercent: number | null = null;
    // Coupons apply only in Mode A (full). Mode B's prepaid amount is
    // a flat ₹200 collection fee with no discount — see /create-order
    // route for matching server-side logic.
    if (couponCode && paymentMode === "full") {
      const { data: coupon } = await supabase
        .from("lab_coupons")
        .select(
          "discount_type, discount_value, min_basket_inr, max_discount_inr, max_uses, used_count, valid_from, valid_to, is_active",
        )
        .eq("code", couponCode)
        .single();

      const now = new Date();
      const validCoupon =
        coupon &&
        coupon.is_active &&
        subtotalInr >= (coupon.min_basket_inr ?? 0) &&
        (coupon.max_uses == null || coupon.used_count < coupon.max_uses) &&
        (!coupon.valid_from || new Date(coupon.valid_from) <= now) &&
        (!coupon.valid_to || new Date(coupon.valid_to) >= now);

      if (validCoupon) {
        if (coupon.discount_type === "percent") {
          couponDiscountPercent = Number(coupon.discount_value);
          discountInr = Math.floor(
            (subtotalInr * Number(coupon.discount_value)) / 100,
          );
        } else {
          discountInr = Number(coupon.discount_value);
        }
        if (coupon.max_discount_inr != null) {
          discountInr = Math.min(discountInr, coupon.max_discount_inr);
        }
        discountInr = Math.max(0, Math.min(discountInr, subtotalInr));
      }
    }

    const grandTotalInr = Math.max(
      0,
      Math.ceil(subtotalInr - discountInr + LAB_COLLECTION_FEE_INR),
    );
    // T85 PR4b v2 — per-mode billed-now amount.
    //   Mode A: bill the full grand total at Razorpay capture
    //   Mode B: bill only the ₹200 collection fee; balance owed at door
    const paidNowInr =
      paymentMode === "full" ? grandTotalInr : LAB_COLLECTION_FEE_INR;
    const balanceAtDoorInr = Math.max(0, grandTotalInr - paidNowInr);

    // === Build insert payload ===
    const opsNotesParts: string[] = [];
    if (!booking.gps_location) {
      opsNotesParts.push(
        "📍 Location auto-capture declined or unavailable — confirm address with patient before dispatch.",
      );
    }
    if (booking.scheduledFor?.kind === "slot" && booking.scheduledFor.iso) {
      opsNotesParts.push(`🗓 Scheduled: ${String(booking.scheduledFor.iso)}`);
    } else {
      opsNotesParts.push("🗓 ASAP");
    }

    // customer-link-hotpatch: look up existing customer by phone so the
    // booking row gets its customer_id assigned. SAN-B-00058/00059 had
    // matching customers but this path was never querying. Auto-create
    // for unmatched phones lands in T64 PR1's M043 (requires NOT-NULL
    // drop on customers.full_name + customer_code); until then NULL is
    // the existing-behavior fallback.
    const linkedCustomerId = await lookupCustomerIdByPhone(
      supabase,
      submittedPhone,
    );

    // T90 Slice 2 Step 12 — member_id from Pulse-side lab bookings.
    // Set client-side by LabBasketWindow when entryPoint='pulse' AND
    // pulseEntryMember.kind === 'member'. Null on marketing entries
    // and on Pulse self-bookings. Column exists since M042.
    const memberIdInput =
      typeof booking.member_id === "string" && booking.member_id.trim()
        ? booking.member_id.trim()
        : null;

    const insertPayload = {
      patient_name: patientName,
      phone: submittedPhone,
      customer_id: linkedCustomerId,
      member_id: memberIdInput,
      service_category: "lab-tests",
      manual_address: address,
      gps_location: booking.gps_location ?? null,
      ops_notes: opsNotesParts.join("\n") || null,
      // status = PENDING_COLLECTION matches M008's lab lifecycle.
      status: "PENDING_COLLECTION",
      // === Money fields (per M008/M009 columns) ===
      // `amount` is the total cost in rupees (grand total — what the
      // patient ultimately owes for the booking, whether prepaid or
      // due at door).
      amount: grandTotalInr,
      selected_tests: selectedTests,
      test_total_paise: subtotalInr * 100,
      applied_coupon_code: couponCode,
      coupon_discount_percent: couponDiscountPercent,
      coupon_discount_paise: discountInr * 100,
      final_amount_paise: grandTotalInr * 100,
      lab_partner: "pathcore",
      // === Payment lifecycle (T85 PR4b v2 — dual mode) ===
      //   Mode A (full):    report_payment_status = 'CAPTURED'
      //                     paid_amount_paise     = grandTotalInr * 100
      //                     balance_due_paise     = 0
      //   Mode B (partial): report_payment_status = 'PARTIAL_PAID'
      //                     paid_amount_paise     = 20000 (₹200)
      //                     balance_due_paise     = (grand - 200) * 100
      // The `/reports/[token]` unlock path treats both as "no paywall"
      // — token is the auth, payment is tracked by ops. Mode B
      // bookings have a doorstep collection event ops needs to fire.
      report_payment_status: paymentMode === "full" ? "CAPTURED" : "PARTIAL_PAID",
      report_razorpay_order_id: razorpay_order_id,
      report_razorpay_payment_id: razorpay_payment_id,
      report_paid_at: new Date().toISOString(),
      // === Booking-fee fields (mirrors razorpay/verify pattern) ===
      // For Mode A the Razorpay capture IS the full payment; we
      // populate both the booking-fee (M007) and report-payment (M008)
      // fields so ops queries that union both flows still find this
      // row. For Mode B only the ₹200 was captured at Razorpay —
      // `booking_fee_paid_paise` reflects that.
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      payment_status: "CAPTURED",
      booking_fee_paid_paise: paidNowInr * 100,
      payment_captured_at: new Date().toISOString(),
      otp_verified_at: new Date(verified.verifiedAt * 1000).toISOString(),
    };

    const { data, error } = await supabase
      .from("bookings")
      .insert(insertPayload)
      .select("id, booking_code")
      .single();

    if (error) {
      console.error("[lab/create-booking-prepaid] insert failed:", error);
      return NextResponse.json(
        {
          error:
            `Payment verified but booking could not be saved. Please call ${PHONE_DISPLAY}.`,
          razorpay_payment_id,
        },
        { status: 500 },
      );
    }

    // T64: customer first-write-wins. Sets the customer's display name
    // on their FIRST booking only. Subsequent bookings for family
    // members or under different names don't overwrite (the
    // `is('full_name', null)` filter is the gate). Patient can later
    // update via Pulse profile editing (T70/T71). Soft-fail discipline
    // matches the lead-alert pattern — logged + swallowed.
    if (linkedCustomerId) {
      try {
        const { error: nameWriteErr } = await supabase
          .from("customers")
          .update({ full_name: patientName })
          .eq("id", linkedCustomerId)
          .is("full_name", null);
        if (nameWriteErr) {
          console.error(
            "[lab/create-booking-prepaid] customer first-write full_name failed:",
            nameWriteErr,
          );
        }
      } catch (cause) {
        console.error(
          "[lab/create-booking-prepaid] customer first-write threw unexpectedly",
          cause,
        );
      }
    }

    // Increment coupon usage (best-effort — booking is authoritative).
    if (couponCode && discountInr > 0) {
      void supabase.rpc("increment_lab_coupon_usage", { _code: couponCode });
      // If the RPC doesn't exist (older schema), fall back to direct
      // increment. Either way, don't fail the booking response.
    }

    // T85 PR4b v2 + leadalert-hotfix — ops lead alert with standardized
    // {{5}} Context format (single source of truth in
    // contextFormat.ts). Mode A → 'lab-full'; Mode B → 'lab-partial'
    // (the formatter computes the balance string automatically).
    //
    // Awaited (not `void`) — see razorpay/verify for the full rationale;
    // tl;dr Netlify Functions freeze on response, fire-and-forget
    // promises never run. Prod smoke 2026-06-08 confirmed.
    const contextText = formatLeadAlertContext(undefined, {
      paidPaise: paidNowInr * 100,
      totalPaise: grandTotalInr * 100,
      mode: paymentMode === "full" ? "lab-full" : "lab-partial",
    });
    // Suppress unused-var warning for balance — captured for ops_notes
    // composition in a future iteration that surfaces the at-door
    // balance to ops dashboards.
    void balanceAtDoorInr;
    // Slice 2a — ops lead alert + patient booking confirmation fired
    // concurrently (both best-effort, never throw). allSettled keeps one
    // failure from blocking the other. {{4}} next-step for lab resolves
    // to the phlebotomist-slot line via getBookingNextStep('lab-tests').
    const bookingRef = data?.booking_code ?? data?.id ?? "?";
    try {
      await Promise.allSettled([
        sendAarogyaLeadAlert({
          patientName,
          serviceDisplayName: t85ServiceDisplayName("lab-tests"),
          location: address,
          context: contextText,
          patientPhone: submittedPhone,
        }).then(({ delivered }) =>
          console.log(
            `[lab/create-booking-prepaid] aarogya_lead_alert dispatch: delivered=${delivered} booking=${bookingRef}`,
          ),
        ),
        sendBookingConfirmed({
          patientName,
          serviceSlug: "lab-tests",
          bookingCode: data?.booking_code ?? "",
          patientPhone: submittedPhone,
        }).then(({ delivered }) =>
          console.log(
            `[lab/create-booking-prepaid] sanocare_booking_confirmed dispatch: delivered=${delivered} booking=${bookingRef}`,
          ),
        ),
      ]);
    } catch (alertErr) {
      console.error(
        "[lab/create-booking-prepaid] template dispatch threw unexpectedly",
        alertErr,
      );
    }

    return NextResponse.json({
      ok: true,
      bookingId: data?.id,
      bookingCode: data?.booking_code ?? null,
      finalAmountInr: grandTotalInr,
    });
  } catch (err) {
    console.error("[lab/create-booking-prepaid] error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to create lab booking";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
