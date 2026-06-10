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
import {
  validatePatientName,
  lookupCustomerIdByPhone,
} from "@/lib/booking/customerLink";
import {
  dbToT85Slug,
  t85ServiceDisplayName,
  t85ToPricingKey,
} from "@/lib/booking/serviceMapper";
import {
  getServiceHalfRoundedUp,
  getServiceRemainingAfterHalf,
} from "@/constants/pricing";
import type { ServiceSlug } from "@/lib/services/catalog";

const VALID_T85_SLUGS: ServiceSlug[] = [
  "home-visit",
  "teleconsultation",
  "lab-tests",
  "medic-at-home",
];

export const runtime = "nodejs";

/**
 * POST /api/razorpay/verify
 *
 * Called by the client after Razorpay Checkout completes successfully.
 * - Verifies the signature server-side (so we trust the payment).
 * - If valid, persists the booking to Supabase with payment fields set.
 *
 * Body:
 *   {
 *     razorpay_order_id, razorpay_payment_id, razorpay_signature,
 *     booking: { patient_name, phone, service_category, manual_address,
 *                gps_location, amount, isBookingForOther }
 *   }
 *
 * Returns:
 *   200 { ok: true, bookingId }
 *   400 { error } — signature invalid or input malformed
 *   500 { error } — Supabase or env issue
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
        { status: 400 }
      );
    }
    if (!booking || typeof booking !== "object") {
      return NextResponse.json({ error: "Missing booking" }, { status: 400 });
    }

    // === OTP verification gate ===
    // The booking-insert path is gated by the signed cookie minted at
    // /api/auth/verify-otp. The cookie's payload must match the phone the
    // patient is booking with. This blocks server-side bypasses where a
    // client could fabricate a booking insert without going through the gate.
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

    // === Signature verification ===
    const valid = verifyPaymentSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });
    if (!valid) {
      console.warn(
        "[razorpay/verify] signature mismatch for order",
        razorpay_order_id
      );
      return NextResponse.json(
        { error: "Payment signature invalid" },
        { status: 400 }
      );
    }

    // === Persist booking ===
    // We use the service-role key so this insert bypasses RLS. Patient-facing
    // bookings can also be inserted via the anon key + RLS policy; we use the
    // service role here because the *payment* has just been verified server-side
    // and we want to write the payment-status fields too.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Supabase server credentials missing" },
        { status: 500 }
      );
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // If the patient's browser couldn't (or wouldn't) share their location,
    // mark the booking so ops knows to collect address from them before
    // dispatch. Never block the booking on a declined permission.
    const opsNotesMarker = booking.gps_location
      ? null
      : "📍 Location auto-capture declined or unavailable — confirm address with patient before dispatch.";

    // T85 PR4a — if the booking carries a T85 slug, write that as the
    // service_category (post-M039 widening accepts both legacy and T85
    // values). booking_fee_paid_paise is server-computed from the slug
    // via getServiceHalfRoundedUp so a tampered client value can't
    // mark a booking as fully prepaid at a lower amount.
    const t85SlugRaw = String(booking.t85Slug || "").trim();
    const t85Slug = (VALID_T85_SLUGS as string[]).includes(t85SlugRaw)
      ? (t85SlugRaw as ServiceSlug)
      : null;
    const persistedServiceCategory = t85Slug
      ? t85Slug
      : String(booking.service_category || "").trim();
    const persistedFeePaise = t85Slug
      ? getServiceHalfRoundedUp(t85ToPricingKey(t85Slug)) * 100
      : 24_900; // Legacy ₹249 flat — unchanged for existing callers.

    // T85 PR4a — schedule snapshot. ASAP rows get null in scheduled_for;
    // slot rows get the ISO start of the 1-hour window. ops surfaces
    // can read scheduled_for to dispatch correctly. Until M040 adds a
    // typed column for this, we round-trip via ops_notes so PR4a doesn't
    // need another migration.
    const scheduledMarker =
      booking.scheduledFor && typeof booking.scheduledFor === "object"
        ? booking.scheduledFor.kind === "slot" && booking.scheduledFor.iso
          ? `🗓 Scheduled: ${String(booking.scheduledFor.iso)}`
          : "🗓 ASAP"
        : "";

    const composedOpsNotes = [opsNotesMarker, scheduledMarker]
      .filter(Boolean)
      .join("\n");

    // customer-link-hotpatch: validate patient_name server-side. The
    // client (LabBasketWindow / IdentifyStep) gates on the same rules,
    // but server validation is the actual contract — silent corruption
    // beats a 400, but a 400 beats writing "Patient" into the DB.
    const nameValidation = validatePatientName(booking.patient_name);
    if (!nameValidation.ok) {
      return NextResponse.json(
        { error: nameValidation.error, razorpay_payment_id },
        { status: 400 },
      );
    }

    // customer-link-hotpatch: look up existing customer by phone and link
    // it. SAN-B-00058/00059 both had matching customers that this path
    // was never querying. customer_id stays NULL when no match exists
    // (T64 PR1 adds the auto-create path).
    const insertCustomerId = await lookupCustomerIdByPhone(
      supabase,
      String(booking.phone || "").trim(),
    );

    const insertPayload = {
      patient_name: nameValidation.name,
      phone: String(booking.phone || "").trim(),
      customer_id: insertCustomerId,
      service_category: persistedServiceCategory,
      manual_address: String(booking.manual_address || "").trim(),
      gps_location: booking.gps_location ?? null,
      ops_notes: composedOpsNotes || null,
      amount: typeof booking.amount === "number" ? booking.amount : null,
      status: "CONFIRMED",
      // Payment fields — see migration 007_razorpay_payments.sql for schema.
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      payment_status: "CAPTURED",
      booking_fee_paid_paise: persistedFeePaise,
      payment_captured_at: new Date().toISOString(),
      // From migration 011 — stamps the OTP-verified moment so ops can
      // audit which bookings went through the phone gate.
      otp_verified_at: new Date(verified.verifiedAt * 1000).toISOString(),
    };

    const { data, error } = await supabase
      .from("bookings")
      .insert(insertPayload)
      .select("id, booking_code")
      .single();

    if (error) {
      console.error("[razorpay/verify] supabase insert failed:", error);
      return NextResponse.json(
        {
          error:
            "Payment verified but booking could not be saved. Please call support.",
          razorpay_payment_id,
        },
        { status: 500 }
      );
    }

    // T85 PR4a + leadalert-hotfix — best-effort ops alert.
    // `sendAarogyaLeadAlert` swallows its own errors (logged via
    // console.error) and never throws here, so the booking response
    // stays authoritative regardless of BSP hiccups.
    //
    // We `await` (not `void`) deliberately: PR4a originally fired this
    // promise-style on the theory that Netlify Functions would honor the
    // pending fetch before container teardown. Prod smoke on Case
    // #SAN-B-00058 (2026-06-08) confirmed that theory is wrong — the
    // serverless function freezes immediately on response, and the
    // pending Rampwin fetch never executes. OTPs work because their send
    // is already awaited (the response depends on send success). Same
    // BSP creds, same wire shape — only call pattern differs. The
    // ~200–800ms latency hit is acceptable; ops needs the alert.
    const displaySlug =
      t85Slug ?? dbToT85Slug(persistedServiceCategory) ?? "home-visit";

    // T85 PR4b v2 — `{{5}}` Context is now a standardized payment
    // summary via formatLeadAlertContext (single source of truth in
    // contextFormat.ts). Non-lab services use 'partial-advance-50':
    // paid = half, total = full = half + remaining. The "notes" half
    // of the format defaults to "—" since PR4a doesn't surface a
    // notes input — when a future iteration adds one, pass it as the
    // first arg.
    const totalInr = t85Slug
      ? getServiceHalfRoundedUp(t85ToPricingKey(t85Slug)) +
        getServiceRemainingAfterHalf(t85ToPricingKey(t85Slug))
      : Math.round(persistedFeePaise / 100) * 2;
    const contextText = formatLeadAlertContext(undefined, {
      paidPaise: persistedFeePaise,
      totalPaise: totalInr * 100,
      mode: "partial-advance-50",
    });

    // Slice 2a — fire the ops lead alert AND the patient booking
    // confirmation concurrently. Both senders are best-effort (never
    // throw); Promise.allSettled keeps one failure from blocking the
    // other and parallelizes the two BSP round-trips so the patient
    // template adds no extra sequential latency on top of the alert.
    const bookingRef = data?.booking_code ?? data?.id ?? "?";
    try {
      await Promise.allSettled([
        sendAarogyaLeadAlert({
          patientName: insertPayload.patient_name,
          // Age is not collected in PR4a Step 1 — defaults to "—y" in the
          // sender. T64 (family-member picker) extends Step 1 with age
          // and can pass `ageWithYearSuffix` here once it ships.
          serviceDisplayName: t85ServiceDisplayName(displaySlug),
          location: insertPayload.manual_address,
          context: contextText,
          patientPhone: insertPayload.phone,
        }).then(({ delivered }) =>
          console.log(
            `[razorpay/verify] aarogya_lead_alert dispatch: delivered=${delivered} booking=${bookingRef}`,
          ),
        ),
        sendBookingConfirmed({
          patientName: insertPayload.patient_name,
          serviceSlug: displaySlug,
          bookingCode: data?.booking_code ?? "",
          patientPhone: insertPayload.phone,
        }).then(({ delivered }) =>
          console.log(
            `[razorpay/verify] sanocare_booking_confirmed dispatch: delivered=${delivered} booking=${bookingRef}`,
          ),
        ),
      ]);
    } catch (alertErr) {
      // Both senders are documented never to throw, and allSettled never
      // rejects — defense in depth so no dispatch path can bubble into
      // the booking response. The booking row is the source of truth.
      console.error(
        "[razorpay/verify] template dispatch threw unexpectedly",
        alertErr,
      );
    }

    return NextResponse.json({
      ok: true,
      bookingId: data?.id,
      bookingCode: data?.booking_code ?? null,
    });
  } catch (err) {
    console.error("[razorpay/verify] error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to verify payment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
