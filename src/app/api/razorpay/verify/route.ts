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
import { linkBookingToMarketingLead } from "@/lib/marketing/closedLoop";
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
import {
  findClickIdsForPhone,
  stampBookingClickIds,
} from "@/lib/wa/attribution";
import { uploadWhatsappConversion } from "@/lib/wa/uploadConversion";
import { persistBookingIdempotent } from "@/lib/booking/paymentSafetyNet";
import { sendOpsAlert } from "@/lib/whatsapp/opsAlert";
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
 * P0 revenue-leak fix (2026-08-17): a valid Razorpay signature is cryptographic
 * proof that the money was captured through our account, so once it verifies a
 * booking MUST be persisted — unconditionally. Two earlier hard gates used to
 * drop proven-paid bookings AFTER capture (returning 401/400 with the money
 * already taken and NO booking row + NO ops alert):
 *   1. The OTP-verify cookie was re-checked here and 401'd when missing/expired.
 *      That cookie is a *session* cookie (no Max-Age) + 30-min token, so it is
 *      routinely gone by post-checkout verify (in-app browsers, tab eviction,
 *      long checkouts) — the dominant cause of the 38 captured-no-booking
 *      orphans. It is now a SOFT attestation: recorded + flagged, never a block.
 *   2. An invalid patient_name returned 400. It now falls back to a flagged
 *      placeholder so the paid booking still lands.
 * Any genuine persistence failure now fires a LOUD ops alert before surfacing
 * an error, and the write is idempotent on razorpay_order_id. A captured
 * payment can no longer yield a silent no-booking.
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
 *   500 { error } — Supabase or env issue (ops alerted)
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

    // === Signature verification FIRST ===
    // The signature is HMAC-SHA256(order_id|payment_id, key_secret) — only a
    // real payment through our Razorpay account produces a valid one. It is the
    // authority for whether a booking should exist, so we check it before any
    // softer gate. An invalid signature means "not a proven payment" and is the
    // only case where we refuse to write a booking on this path.
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
    // Service-role key so the insert bypasses RLS and can write payment-status
    // fields the anon policy wouldn't allow. The payment is already proven above.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!supabaseUrl || !serviceRoleKey) {
      // Money captured, but we cannot write. LOUD, never silent.
      await sendOpsAlert({
        conversationId: null,
        escalationId: null,
        patientName: "⚠ PAID — SERVER MISCONFIGURED",
        patientAge: "—",
        serviceDisplay: String(
          booking.t85Slug || booking.service_category || "unknown",
        ),
        location: "Supabase credentials missing on /api/razorpay/verify",
        context: `Captured payment ${razorpay_payment_id} (order ${razorpay_order_id}) could NOT be saved — Supabase creds missing. Reconcile manually.`,
        patientMobile: String(booking.phone || "unknown"),
      });
      return NextResponse.json(
        { error: "Supabase server credentials missing", razorpay_payment_id },
        { status: 500 }
      );
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // === OTP attestation — SOFT (never blocks a proven-paid booking) ===
    // Record whether the booking phone was OTP-verified via the signed cookie,
    // but NEVER 401 on a miss: the signature above already proves the payment.
    // A missing/expired cookie only means we couldn't re-attest the phone here
    // — ops is flagged (below) to confirm identity, and the booking still lands.
    const verifyCookie = req.cookies.get(VERIFY_COOKIE_NAME)?.value;
    const verified = verifyToken(verifyCookie);
    const submittedPhone = normaliseIndianPhone(String(booking.phone ?? ""));
    const otpAttested =
      !!verified && !!submittedPhone && submittedPhone === verified.phone;

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

    // customer-link-hotpatch: validate patient_name server-side. The paid
    // booking must still land even if the name is unusable, so a failed
    // validation now falls back to a flagged placeholder instead of a 400
    // that would drop the (already-captured) payment.
    const nameValidation = validatePatientName(booking.patient_name);
    const resolvedPatientName = nameValidation.ok
      ? nameValidation.name
      : "[Name pending — collect from patient]";

    // Post-capture attestation flags for ops. Prepended to ops_notes so a
    // partially-attested booking is obvious in the ops worklist.
    const attestationFlags = [
      otpAttested
        ? null
        : "⚠ UNVERIFIED PHONE — OTP attestation missing/expired at payment verify; confirm patient identity before dispatch.",
      nameValidation.ok ? null : "⚠ NAME NOT CAPTURED — collect patient name.",
    ]
      .filter(Boolean)
      .join("\n");

    const composedOpsNotes = [attestationFlags, opsNotesMarker, scheduledMarker]
      .filter(Boolean)
      .join("\n");

    // customer-link-hotpatch: look up existing customer by phone and link
    // it. customer_id stays NULL when no match exists (T64 PR1 adds the
    // auto-create path).
    const insertCustomerId = await lookupCustomerIdByPhone(
      supabase,
      String(booking.phone || "").trim(),
    );

    // T90 Slice 2 Step 12 — member_id from Pulse-side bookings. Null on
    // marketing entries and Pulse self-bookings.
    const memberIdInput =
      typeof booking.member_id === "string" && booking.member_id.trim()
        ? booking.member_id.trim()
        : null;

    const insertPayload = {
      patient_name: resolvedPatientName,
      phone: String(booking.phone || "").trim(),
      customer_id: insertCustomerId,
      member_id: memberIdInput,
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
      // Soft OTP attestation — the verified moment when the phone was
      // OTP-checked, or NULL when the cookie was absent/expired at verify.
      otp_verified_at:
        otpAttested && verified
          ? new Date(verified.verifiedAt * 1000).toISOString()
          : null,
    };

    // Idempotent insert keyed by razorpay_order_id (partial unique index,
    // migration 20260720120000). On a unique violation the existing row is
    // upgraded in place (a webhook reconciliation stub, or a double-submit);
    // on any genuine failure a LOUD ops alert fires before we surface the error
    // so a captured payment can never yield a silent no-booking.
    const persist = await persistBookingIdempotent(
      insertPayload,
      razorpay_order_id,
      { supabase },
    );
    if (!persist.ok) {
      console.error(
        "[razorpay/verify] booking persist failed (ops alerted):",
        persist.error,
      );
      return NextResponse.json(
        {
          error:
            "Payment verified but booking could not be saved. Please call support.",
          razorpay_payment_id,
        },
        { status: 500 },
      );
    }
    const data = { id: persist.bookingId, booking_code: persist.bookingCode };
    const wasNewlyInserted = persist.wasNewlyInserted;

    // T64: customer first-write-wins. Sets the customer's display name on
    // their FIRST booking only, and only when we actually captured a real
    // name (never the "[Name pending]" placeholder). Soft-fail discipline
    // matches the lead-alert pattern — logged + swallowed.
    if (wasNewlyInserted && insertCustomerId && nameValidation.ok) {
      try {
        const { error: nameWriteErr } = await supabase
          .from("customers")
          .update({ full_name: nameValidation.name })
          .eq("id", insertCustomerId)
          .is("full_name", null);
        if (nameWriteErr) {
          console.error(
            "[razorpay/verify] customer first-write full_name failed:",
            nameWriteErr,
          );
        }
      } catch (cause) {
        console.error(
          "[razorpay/verify] customer first-write threw unexpectedly",
          cause,
        );
      }
    }

    // T85 PR4a + leadalert-hotfix — best-effort ops alert.
    // `sendAarogyaLeadAlert` swallows its own errors (logged via
    // console.error) and never throws here, so the booking response
    // stays authoritative regardless of BSP hiccups.
    //
    // We `await` (not `void`) deliberately: the serverless function freezes
    // immediately on response, so a pending (un-awaited) Rampwin fetch never
    // executes. The ~200–800ms latency hit is acceptable; ops needs the alert.
    const displaySlug =
      t85Slug ?? dbToT85Slug(persistedServiceCategory) ?? "home-visit";

    // T85 PR4b v2 — `{{5}}` Context is a standardized payment summary via
    // formatLeadAlertContext (single source of truth in contextFormat.ts).
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
    // throw); Promise.allSettled keeps one failure from blocking the other.
    const bookingRef = data?.booking_code ?? data?.id ?? "?";
    // Only fire on a genuinely new booking. On the idempotent-upgrade path
    // (a webhook reconciliation stub, or a double-submit) the webhook already
    // alerted ops for this order, so re-sending here would double-notify.
    if (wasNewlyInserted) {
    try {
      await Promise.allSettled([
        sendAarogyaLeadAlert({
          patientName: insertPayload.patient_name,
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

      // Marketing closed-loop — link this booking back to the marketing lead
      // that drove it (matched by phone): flip the lead to `booked` + roll up
      // its lifetime_value_paise. Soft-fail; the booking row stays the source
      // of truth. Inside the `wasNewlyInserted` guard so the LTV roll-up can
      // never double-count on the idempotent-upgrade path.
      if (data?.id) {
        await linkBookingToMarketingLead({
          phone: insertPayload.phone,
          bookingId: data.id as string,
          // booking.amount is rupees here (no final_amount_paise on this path) → paise.
          amountPaise:
            typeof booking.amount === "number" ? Math.round(booking.amount * 100) : null,
        });
      }

      // WhatsApp → Google Ads offline conversion. ~70% of bookings close over
      // WhatsApp, and `whatsapp_click_paid` is an UPLOAD_CLICKS action that has
      // never been fed. If this phone's WhatsApp thread carries a gclid (captured
      // at the ad click, carried through the `[ref: SC-…]` handoff and stamped by
      // the inbound handler), stamp it on the booking and upload the paid
      // conversion. Best-effort + env-flagged, exactly like the lead alert above:
      // a failure here must never break the booking/payment response.
      if (data?.id) {
        try {
          const clickIds = await findClickIdsForPhone(insertPayload.phone);
          if (clickIds.gclid) {
            await stampBookingClickIds({
              bookingId: data.id as string,
              gclid: clickIds.gclid,
              wbraid: clickIds.wbraid,
            });
            // Upload the FULL order value (not just the 50% advance) — the
            // bidder should optimise toward booking worth, not cash collected now.
            const conv = await uploadWhatsappConversion({
              gclid: clickIds.gclid,
              valueInr: totalInr,
              occurredAt: new Date(insertPayload.payment_captured_at),
            });
            console.log(
              `[razorpay/verify] wa_conv_upload uploaded=${conv.uploaded}${conv.reason ? ` reason=${conv.reason}` : ""} booking=${bookingRef}`,
            );
          }
        } catch (convErr) {
          console.error(`WA_CONV_UPLOAD_FAILED booking=${bookingRef}`, convErr);
        }
      }
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
