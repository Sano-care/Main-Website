import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPaymentSignature } from "@/lib/razorpay";
import {
  VERIFY_COOKIE_NAME,
  normaliseIndianPhone,
  verifyToken,
} from "@/lib/otp/token";
import { sendAarogyaLeadAlert } from "@/lib/booking/meta";
import { sendBookingConfirmed } from "@/lib/aarogya/meta";
import { formatLeadAlertContext } from "@/lib/booking/contextFormat";
import { t85ServiceDisplayName } from "@/lib/booking/serviceMapper";
import {
  validatePatientName,
  lookupCustomerIdByPhone,
} from "@/lib/booking/customerLink";
import {
  persistBookingIdempotent,
  alertOnPostCaptureFailure,
} from "@/lib/booking/paymentSafetyNet";
import { attachClickIdsToBooking } from "@/lib/wa/attribution";
import { LAB_COLLECTION_FEE_INR } from "@/lib/services/labCatalog";
import { linkBookingToMarketingLead } from "@/lib/marketing/closedLoop";

export const runtime = "nodejs";

/**
 * POST /api/lab/create-booking-prepaid
 *
 * T85 PR4b — full-prepaid lab booking. Post-#159 parity: a valid Razorpay
 * signature proves the money is captured, so this route no longer drops a
 * proven-paid booking:
 *   - Signature is verified FIRST — ahead of the OTP cookie (which used to hard
 *     401 here exactly like the pre-#159 web verify, dropping paid bookings when
 *     the session cookie had expired at post-checkout verify).
 *   - The OTP cookie is now a SOFT attestation (stamp otp_verified_at when it
 *     matches, flag ops when it doesn't) — never a 401.
 *   - Recoverable validation (name/address) → persist-and-flag, not a 400.
 *   - The write is idempotent + LOUD (persistBookingIdempotent).
 *
 * Coexists with the legacy `/api/lab/create-booking` (free-at-booking).
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

    // === Razorpay signature FIRST (money is captured once this passes) ===
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

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!supabaseUrl || !serviceRoleKey) {
      await alertOnPostCaptureFailure({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        serviceDisplay: "Lab Tests at Home",
        reason: "Supabase credentials missing on /api/lab/create-booking-prepaid",
      });
      return NextResponse.json(
        { error: "Supabase server credentials missing", razorpay_payment_id },
        { status: 500 },
      );
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // === OTP attestation — SOFT (never blocks a proven-paid booking) ===
    const submittedPhone = normaliseIndianPhone(String(booking.phone ?? ""));
    const verified = verifyToken(req.cookies.get(VERIFY_COOKIE_NAME)?.value);
    const otpAttested =
      !!verified && !!submittedPhone && submittedPhone === verified.phone;
    const phone = submittedPhone ?? String(booking.phone ?? "").trim();

    const flags: string[] = [];
    if (!otpAttested) {
      flags.push(
        "⚠ UNVERIFIED PHONE — OTP attestation missing/expired at payment verify; confirm patient identity before dispatch.",
      );
    }

    // === Recoverable validation → persist-and-flag (never a 400 post-capture) ===
    const nameValidation = validatePatientName(booking.patient_name);
    const patientName = nameValidation.ok
      ? nameValidation.name
      : "[Name pending — collect from patient]";
    if (!nameValidation.ok) flags.push("⚠ NAME NOT CAPTURED — collect patient name.");

    let address = String(booking.manual_address ?? "").trim();
    if (address.length < 10) {
      flags.push("⚠ ADDRESS MISSING/SHORT — collect the collection address before dispatch.");
      address = address || "[Address pending — collect from patient]";
    }

    const selectedTests = Array.isArray(booking.selected_tests)
      ? booking.selected_tests
      : [];
    if (selectedTests.length === 0) {
      // No tests → we can't compute the real basket the payment was for. Money
      // IS captured — alert loudly (the reconciler will also stub it) rather
      // than book an empty, mis-priced lab order.
      await alertOnPostCaptureFailure({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        contact: phone || null,
        serviceDisplay: "Lab Tests at Home",
        reason: "Empty test basket at verify — cannot reconcile paid basket",
      });
      return NextResponse.json(
        { error: "Pick at least one lab test before booking." },
        { status: 400 },
      );
    }

    // === Server-side re-pricing ===
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

    const paymentMode =
      booking.paymentMode === "partial" ? "partial" : "full";

    let discountInr = 0;
    let couponDiscountPercent: number | null = null;
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
    const paidNowInr =
      paymentMode === "full" ? grandTotalInr : LAB_COLLECTION_FEE_INR;
    const balanceAtDoorInr = Math.max(0, grandTotalInr - paidNowInr);

    // === Build insert payload ===
    const opsNotesParts: string[] = [...flags];
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

    const linkedCustomerId = phone
      ? await lookupCustomerIdByPhone(supabase, phone)
      : null;

    const memberIdInput =
      typeof booking.member_id === "string" && booking.member_id.trim()
        ? booking.member_id.trim()
        : null;

    const insertPayload = {
      patient_name: patientName,
      phone: phone || "unknown",
      customer_id: linkedCustomerId,
      member_id: memberIdInput,
      service_category: "lab-tests",
      manual_address: address,
      gps_location: booking.gps_location ?? null,
      ops_notes: opsNotesParts.join("\n") || null,
      status: "PENDING_COLLECTION",
      amount: grandTotalInr,
      selected_tests: selectedTests,
      test_total_paise: subtotalInr * 100,
      applied_coupon_code: couponCode,
      coupon_discount_percent: couponDiscountPercent,
      coupon_discount_paise: discountInr * 100,
      final_amount_paise: grandTotalInr * 100,
      lab_partner: "pathcore",
      report_payment_status: paymentMode === "full" ? "CAPTURED" : "PARTIAL_PAID",
      report_razorpay_order_id: razorpay_order_id,
      report_razorpay_payment_id: razorpay_payment_id,
      report_paid_at: new Date().toISOString(),
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      payment_status: "CAPTURED",
      booking_fee_paid_paise: paidNowInr * 100,
      payment_captured_at: new Date().toISOString(),
      otp_verified_at:
        otpAttested && verified
          ? new Date(verified.verifiedAt * 1000).toISOString()
          : null,
    };

    // Idempotent + LOUD write (fires the ops alert itself on any DB failure).
    const persist = await persistBookingIdempotent(insertPayload, razorpay_order_id, {
      supabase,
    });
    if (!persist.ok) {
      console.error("[lab/create-booking-prepaid] persist failed (ops alerted):", persist.error);
      return NextResponse.json(
        {
          error: "Payment verified but booking could not be saved. Please call support.",
          razorpay_payment_id,
        },
        { status: 500 },
      );
    }
    const data = { id: persist.bookingId, booking_code: persist.bookingCode };

    // Paid attribution — copy the phone's recent WhatsApp gclid onto the
    // booking (best-effort; never fails the paid booking).
    await attachClickIdsToBooking({ bookingId: data.id, phone });

    // T64: customer first-write-wins — only a real (non-placeholder) name, on a
    // genuinely new booking.
    if (persist.wasNewlyInserted && linkedCustomerId && nameValidation.ok) {
      try {
        const { error: nameWriteErr } = await supabase
          .from("customers")
          .update({ full_name: nameValidation.name })
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

    if (couponCode && discountInr > 0) {
      void supabase.rpc("increment_lab_coupon_usage", { _code: couponCode });
    }

    void balanceAtDoorInr;

    // Alerts + marketing link — only on a genuinely new booking so the
    // idempotent-upgrade path can't double-fire.
    if (persist.wasNewlyInserted) {
      const contextText = formatLeadAlertContext(undefined, {
        paidPaise: paidNowInr * 100,
        totalPaise: grandTotalInr * 100,
        mode: paymentMode === "full" ? "lab-full" : "lab-partial",
      });
      const bookingRef = data?.booking_code ?? data?.id ?? "?";
      try {
        await Promise.allSettled([
          sendAarogyaLeadAlert({
            patientName,
            serviceDisplayName: t85ServiceDisplayName("lab-tests"),
            location: address,
            context:
              (flags.length ? `${flags.join(" ")} · ` : "") + contextText,
            patientPhone: phone,
          }).then(({ delivered }) =>
            console.log(
              `[lab/create-booking-prepaid] aarogya_lead_alert dispatch: delivered=${delivered} booking=${bookingRef}`,
            ),
          ),
          sendBookingConfirmed({
            patientName,
            serviceSlug: "lab-tests",
            bookingCode: data?.booking_code ?? "",
            patientPhone: phone,
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

      if (data?.id) {
        await linkBookingToMarketingLead({
          phone,
          bookingId: data.id as string,
          amountPaise: grandTotalInr * 100,
        });
      }
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
