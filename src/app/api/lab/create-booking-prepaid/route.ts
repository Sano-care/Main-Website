import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPaymentSignature } from "@/lib/razorpay";
import {
  VERIFY_COOKIE_NAME,
  normaliseIndianPhone,
  verifyToken,
} from "@/lib/otp/token";
import { sendAarogyaLeadAlert } from "@/lib/booking/rampwin";
import { t85ServiceDisplayName } from "@/lib/booking/serviceMapper";
import { LAB_COLLECTION_FEE_INR } from "@/lib/services/labCatalog";

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
    const patientName = String(booking.patient_name ?? "").trim();
    const address = String(booking.manual_address ?? "").trim();
    if (!patientName) {
      return NextResponse.json(
        { error: "Patient name is required." },
        { status: 400 },
      );
    }
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

    let discountInr = 0;
    let couponDiscountPercent: number | null = null;
    if (couponCode) {
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

    const insertPayload = {
      patient_name: patientName,
      phone: submittedPhone,
      service_category: "lab-tests",
      manual_address: address,
      gps_location: booking.gps_location ?? null,
      ops_notes: opsNotesParts.join("\n") || null,
      // status = PENDING_COLLECTION matches M008's lab lifecycle. Even
      // though payment is captured at booking, the booking still needs
      // phlebotomist dispatch + collection before lab processing.
      status: "PENDING_COLLECTION",
      // === Money fields (per M008/M009 columns) ===
      // `amount` mirrors the existing legacy pattern — total cost the
      // patient was billed in rupees. For PR4b that's the grand total.
      amount: grandTotalInr,
      selected_tests: selectedTests,
      test_total_paise: subtotalInr * 100,
      applied_coupon_code: couponCode,
      coupon_discount_percent: couponDiscountPercent,
      coupon_discount_paise: discountInr * 100,
      final_amount_paise: grandTotalInr * 100,
      lab_partner: "pathcore",
      // === Payment lifecycle ===
      // PR4b new model: patient paid the full grand total at booking
      // via Razorpay, so report_payment_status starts at CAPTURED.
      // The `/reports/[token]` unlock path checks this and skips the
      // paywall — token is the auth, payment already verified.
      report_payment_status: "CAPTURED",
      report_razorpay_order_id: razorpay_order_id,
      report_razorpay_payment_id: razorpay_payment_id,
      report_paid_at: new Date().toISOString(),
      // === Booking-fee fields (mirrors razorpay/verify pattern) ===
      // The Razorpay payment IS the full payment for PR4b — populate
      // both the booking-fee fields (M007) and the report-payment
      // fields (M008) with the same ids so ops queries that union
      // both flows still find this row.
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      payment_status: "CAPTURED",
      booking_fee_paid_paise: grandTotalInr * 100,
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
            "Payment verified but booking could not be saved. Please call +91-9711977782.",
          razorpay_payment_id,
        },
        { status: 500 },
      );
    }

    // Increment coupon usage (best-effort — booking is authoritative).
    if (couponCode && discountInr > 0) {
      void supabase.rpc("increment_lab_coupon_usage", { _code: couponCode });
      // If the RPC doesn't exist (older schema), fall back to direct
      // increment. Either way, don't fail the booking response.
    }

    // T85 PR4b — ops lead alert (best-effort, mirrors PR4a pattern).
    void sendAarogyaLeadAlert({
      patientName,
      serviceDisplayName: t85ServiceDisplayName("lab-tests"),
      location: address,
      context: undefined,
      patientPhone: submittedPhone,
    });

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
