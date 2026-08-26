import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import { verifyPaymentSignature, getRazorpayClient } from "@/lib/razorpay";
import { getServiceHalfRoundedUp } from "@/constants/pricing";
import {
  validatePatientName,
  lookupCustomerIdByPhone,
} from "@/lib/booking/customerLink";
import { normaliseIndianPhone } from "@/lib/otp/token";
import {
  persistBookingIdempotent,
  alertOnPostCaptureFailure,
} from "@/lib/booking/paymentSafetyNet";
import { createTeleconsultSession } from "@/lib/consult/createSession";
import { resolveTeleconsultDoctor } from "@/lib/consult/teleconsultDoctor";
import { sendBookingConfirmed } from "@/lib/aarogya/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/pulse/teleconsult/verify
 *
 * PB4a — native (bearer) teleconsult booking. Post-#159 parity: once the
 * signature verifies the money is captured, so this route never silently drops
 * a proven-paid transaction:
 *   - Signature is verified FIRST — ahead of auth.
 *   - Auth is SOFT: a valid signature with a failed/expired session does not
 *     401; the booking is persisted with the identity recovered from the
 *     Razorpay payment contact (+ a loud ops alert).
 *   - Recoverable validation (member/name) → persist-and-flag, not a 400.
 *   - The booking write is idempotent + LOUD (persistBookingIdempotent).
 *
 * Still creates the consultation_sessions + participant and fires
 * sanocare_booking_confirmed with the clamped slot in {{4}}.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Clamp a UTC instant into the 09:00–21:00 Asia/Kolkata booking window. */
function clampToIstWindow(base: Date): Date {
  const ist = new Date(base.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  const hour = ist.getUTCHours();
  const at0900 = new Date(Date.UTC(y, m, d, 9, 0, 0) - IST_OFFSET_MS);
  if (hour < 9) return at0900; // before hours → today 09:00 IST
  if (hour >= 21) return new Date(at0900.getTime() + DAY_MS); // after hours → next 09:00 IST
  return base;
}

function formatIstSlot(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      booking,
    } = body ?? {};

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json({ error: "Missing Razorpay payment fields" }, { status: 400 });
    }
    if (!booking || typeof booking !== "object") {
      return NextResponse.json({ error: "Missing booking" }, { status: 400 });
    }

    // === Signature verification FIRST (money is captured once this passes) ===
    const valid = verifyPaymentSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });
    if (!valid) {
      console.warn("[pulse/teleconsult/verify] signature mismatch for order", razorpay_order_id);
      return NextResponse.json({ error: "Payment signature invalid" }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      await alertOnPostCaptureFailure({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        serviceDisplay: "Teleconsultation",
        reason: "Supabase credentials missing on /api/pulse/teleconsult/verify",
      });
      return NextResponse.json({ error: "Server credentials missing" }, { status: 500 });
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // === Auth is SOFT — never 401 a proven-paid booking ===
    const auth = await requirePulseCustomer(req);
    const authedCustomer = "customer" in auth ? auth.customer : null;

    // === Resolve identity ===
    // Authed → the signed-in customer. Auth failed but signature valid → recover
    // the payer from the Razorpay payment contact (teleconsult orders carry no
    // customer_id in notes) and FLAG it; the booking still lands.
    const flags: string[] = [];
    let customerId: string | null = null;
    let customerPhone = "";
    let selfName: string | null = null;
    if (authedCustomer) {
      customerId = authedCustomer.id;
      customerPhone = authedCustomer.phone;
      selfName = authedCustomer.full_name;
    } else {
      flags.push(
        "⚠ SESSION EXPIRED at verify — payer recovered from the payment contact; confirm patient identity.",
      );
      try {
        const payment = await getRazorpayClient().payments.fetch(razorpay_payment_id);
        const contactPhone = normaliseIndianPhone(String(payment?.contact ?? ""));
        if (contactPhone) {
          customerPhone = contactPhone;
          customerId = await lookupCustomerIdByPhone(supabase, contactPhone);
        }
      } catch (e) {
        console.error("[pulse/teleconsult/verify] payment fetch (identity recovery) failed", e);
      }
    }

    // === Resolve patient (self, or a validated family member) ===
    const memberIdRaw =
      typeof booking.member_id === "string" && booking.member_id.trim()
        ? booking.member_id.trim()
        : null;
    let memberId: string | null = null;
    let rawPatientName: string | null = selfName;
    if (memberIdRaw && authedCustomer) {
      const { data: member } = await supabase
        .from("family_members")
        .select("id, name")
        .eq("id", memberIdRaw)
        .eq("customer_id", authedCustomer.id) // IDOR guard
        .maybeSingle();
      if (member) {
        memberId = member.id as string;
        rawPatientName = member.name as string;
      } else {
        flags.push(
          "⚠ MEMBER NOT VALIDATED — the selected family member isn't on this account; booked under the account holder.",
        );
      }
    } else if (memberIdRaw && !authedCustomer) {
      flags.push("⚠ MEMBER NOT VALIDATED (session expired) — booked under the recovered account.");
    }

    // === Recoverable validation → persist-and-flag (never a 400 post-capture) ===
    const nameValidation = validatePatientName(rawPatientName);
    const patientName = nameValidation.ok
      ? nameValidation.name
      : "[Name pending — collect from patient]";
    if (!nameValidation.ok) flags.push("⚠ NAME NOT CAPTURED — collect patient name.");

    // Address is OPTIONAL for teleconsultation (video consult) — null when absent.
    const manualAddressRaw = String(booking.manual_address ?? "").trim();
    const manualAddress: string | null =
      manualAddressRaw.length >= 4 ? manualAddressRaw : null;

    // === Scheduling — clamp server-side to 09:00–21:00 Asia/Kolkata ===
    const now = new Date();
    let target =
      booking.earliest === true
        ? new Date(now.getTime() + 15 * 60 * 1000)
        : new Date(String(booking.scheduled_for ?? ""));
    if (Number.isNaN(target.getTime()) || target.getTime() < now.getTime()) {
      target = new Date(now.getTime() + 15 * 60 * 1000);
    }
    target = clampToIstWindow(target);
    const scheduledForIso = target.toISOString();

    // === Persist booking (service-role; payment just verified) ===
    const advancePaise = getServiceHalfRoundedUp("teleconsult") * 100; // ₹200 → 20000
    const baseOpsNotes = manualAddress
      ? "🎥 Pulse app teleconsult (video) — address provided (no GPS capture)."
      : "🎥 Pulse app teleconsult (video) — no address (optional for video).";
    const opsNotes = [flags.join("\n"), baseOpsNotes].filter(Boolean).join("\n");

    const insertPayload = {
      patient_name: patientName,
      phone: customerPhone || "unknown",
      customer_id: customerId,
      member_id: memberId,
      service_category: "teleconsultation",
      manual_address: manualAddress,
      gps_location: null,
      ops_notes: opsNotes,
      amount: getServiceHalfRoundedUp("teleconsult"), // advance in ₹ captured now
      scheduled_for: scheduledForIso,
      status: "CONFIRMED",
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      payment_status: "CAPTURED",
      booking_fee_paid_paise: advancePaise,
      payment_captured_at: new Date().toISOString(),
      otp_verified_at: authedCustomer ? new Date().toISOString() : null,
    };

    // Idempotent + LOUD write (fires the ops alert itself on any DB failure).
    const persist = await persistBookingIdempotent(insertPayload, razorpay_order_id, {
      supabase,
    });
    if (!persist.ok) {
      console.error("[pulse/teleconsult/verify] booking persist failed (ops alerted):", persist.error);
      return NextResponse.json(
        {
          error: "Payment captured but booking could not be saved. Please contact support.",
          razorpay_payment_id,
        },
        { status: 500 },
      );
    }
    const bookingId = persist.bookingId as string;
    const bookingCode = persist.bookingCode ?? null;

    // === Create the consult session (idempotent by booking) + confirm once ===
    const { data: existingSession } = await supabase
      .from("consultation_sessions")
      .select("id")
      .eq("booking_id", bookingId)
      .maybeSingle();

    if (!existingSession && persist.wasNewlyInserted) {
      const doctor = await resolveTeleconsultDoctor(supabase);
      if (doctor) {
        try {
          await createTeleconsultSession(supabase, {
            bookingId,
            doctorId: doctor.id,
            dutyRoomUrl: doctor.duty_room_join_url,
            scheduledAtIso: scheduledForIso,
            customerId: customerId,
            createdBy: null, // native path has no ops user (column is nullable)
          });
        } catch (sessionErr) {
          console.error(
            `[pulse/teleconsult/verify] session create failed for booking ${bookingCode ?? bookingId} — ops must attach one:`,
            sessionErr,
          );
        }
      } else {
        console.error(
          `[pulse/teleconsult/verify] no teleconsult doctor resolved — booking ${bookingCode ?? bookingId} created without a session; ops must assign a doctor.`,
        );
      }

      // Booking-confirmed WhatsApp — best-effort (never throws). Slot → {{4}}.
      // Skip if we have no phone (identity recovery failed) — can't message.
      if (customerPhone) {
        const slotLine = `Scheduled for ${formatIstSlot(scheduledForIso)}. Your video link arrives ~10 min before.`;
        await sendBookingConfirmed({
          patientName,
          serviceSlug: "teleconsultation",
          bookingCode: bookingCode ?? "",
          patientPhone: customerPhone,
          nextStepOverride: slotLine,
        })
          .then(({ delivered }) =>
            console.log(
              `[pulse/teleconsult/verify] sanocare_booking_confirmed delivered=${delivered} booking=${bookingCode ?? bookingId}`,
            ),
          )
          .catch((e) =>
            console.error("[pulse/teleconsult/verify] booking-confirmed send threw", e),
          );
      }
    }

    // Any post-capture flag (session expired / member / name) → loud ops alert
    // so ops can confirm the patient even when the normal confirmation ran.
    if (flags.length) {
      await alertOnPostCaptureFailure({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        amountPaise: advancePaise,
        contact: customerPhone || null,
        serviceDisplay: "Teleconsultation",
        reason: `Booking saved WITH FLAGS: ${flags.join(" ")}`,
      });
    }

    return NextResponse.json({
      ok: true,
      bookingId,
      bookingCode,
      scheduledFor: scheduledForIso,
    });
  } catch (err) {
    console.error("[pulse/teleconsult/verify] error:", err);
    const message = err instanceof Error ? err.message : "Failed to verify payment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
