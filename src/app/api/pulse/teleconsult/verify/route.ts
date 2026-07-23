import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import { verifyPaymentSignature } from "@/lib/razorpay";
import { getServiceHalfRoundedUp } from "@/constants/pricing";
import { validatePatientName } from "@/lib/booking/customerLink";
import { createTeleconsultSession } from "@/lib/consult/createSession";
import { resolveTeleconsultDoctor } from "@/lib/consult/teleconsultDoctor";
import { sendBookingConfirmed } from "@/lib/aarogya/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/pulse/teleconsult/verify
 *
 * PB4a — the native (bearer) successor to the web /api/razorpay/verify for
 * teleconsultation. Same payment safety (signature verify + #140 idempotency on
 * razorpay_order_id + webhook safety net), but authed via requirePulseCustomer
 * (bearer token / cookie) instead of the OTP cookie phone-match, and scoped to
 * the caller's own customer + (validated) family member.
 *
 * Unlike the web patient path, this also creates the consultation_sessions +
 * participant (join token) via the shared createTeleconsultSession(), writes a
 * typed scheduled_for (clamped to the 09:00–21:00 Asia/Kolkata window server-
 * side), and fires sanocare_booking_confirmed with the slot in {{4}}. It does
 * NOT deliver the join link — the cron sender (PR-B) owns that, ~10 min before.
 *
 * Body:
 *   {
 *     razorpay_order_id, razorpay_payment_id, razorpay_signature,
 *     booking: {
 *       member_id?: string | null,   // family member; validated to belong to caller
 *       manual_address: string,      // required (MoHFW); app has no GPS
 *       earliest?: boolean,          // true = ~15 min; else use scheduled_for
 *       scheduled_for?: string       // ISO; used when earliest !== true
 *     }
 *   }
 *
 *   200 { ok, bookingId, bookingCode, scheduledFor }
 *   400 { error } | 401 { error } | 500 { error }
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
    const auth = await requirePulseCustomer(req);
    if ("response" in auth) return auth.response;
    const { customer } = auth;

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

    // === Signature verification (secret stays server-side) ===
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
      return NextResponse.json({ error: "Server credentials missing" }, { status: 500 });
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // === Resolve patient (self or a validated family member) ===
    // WhatsApp always goes to the account holder's phone; a member booking just
    // changes the patient name on the booking row.
    const memberIdRaw =
      typeof booking.member_id === "string" && booking.member_id.trim()
        ? booking.member_id.trim()
        : null;
    let memberId: string | null = null;
    let rawPatientName: string | null = customer.full_name;
    if (memberIdRaw) {
      const { data: member } = await supabase
        .from("family_members")
        .select("id, name")
        .eq("id", memberIdRaw)
        .eq("customer_id", customer.id) // IDOR guard — member must belong to caller
        .maybeSingle();
      if (!member) {
        return NextResponse.json(
          { error: "That family member isn't on your account." },
          { status: 400 },
        );
      }
      memberId = member.id as string;
      rawPatientName = member.name as string;
    }
    const nameValidation = validatePatientName(rawPatientName);
    if (!nameValidation.ok) {
      return NextResponse.json({ error: nameValidation.error }, { status: 400 });
    }

    const manualAddress = String(booking.manual_address ?? "").trim();
    if (manualAddress.length < 4) {
      return NextResponse.json(
        { error: "Please enter an address (required for teleconsultation records)." },
        { status: 400 },
      );
    }

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
    const insertPayload = {
      patient_name: nameValidation.name,
      phone: customer.phone,
      customer_id: customer.id,
      member_id: memberId,
      service_category: "teleconsultation",
      manual_address: manualAddress,
      gps_location: null,
      // Teleconsult needs no dispatch, but flag that address was manual (no GPS
      // in the app) so ops has the MoHFW context. Schedule is a typed column now.
      ops_notes: "📍 Pulse app teleconsult — address entered manually (no GPS capture).",
      amount: getServiceHalfRoundedUp("teleconsult"), // advance in ₹ captured now
      scheduled_for: scheduledForIso,
      status: "CONFIRMED",
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      payment_status: "CAPTURED",
      booking_fee_paid_paise: advancePaise,
      payment_captured_at: new Date().toISOString(),
      otp_verified_at: new Date().toISOString(), // bearer session ⇒ prior OTP verify
    };

    // Idempotent insert — the partial unique index on bookings(razorpay_order_id)
    // (#140) guarantees one booking per order even if the webhook safety net
    // already stubbed this capture or the client double-submits. On a unique
    // violation we upgrade the existing row with the real details.
    const inserted = await supabase
      .from("bookings")
      .insert(insertPayload)
      .select("id, booking_code")
      .single();
    let data = inserted.data;
    let error = inserted.error;

    if (error && (error as { code?: string }).code === "23505") {
      const upgraded = await supabase
        .from("bookings")
        .update(insertPayload)
        .eq("razorpay_order_id", razorpay_order_id)
        .select("id, booking_code")
        .single();
      data = upgraded.data;
      error = upgraded.error;
      console.info(
        "[pulse/teleconsult/verify] order already had a booking — upgraded in place",
        razorpay_order_id,
      );
    }

    if (error || !data) {
      console.error("[pulse/teleconsult/verify] booking insert failed:", error);
      return NextResponse.json(
        {
          error: "Payment captured but booking could not be saved. Please contact support.",
          razorpay_payment_id,
        },
        { status: 500 },
      );
    }

    const bookingId = data.id as string;
    const bookingCode = (data.booking_code as string | null) ?? null;

    // === Create the consult session (idempotent by booking) + confirm once ===
    // Guard on an existing session so a retried verify (or a webhook-stub upgrade)
    // never double-creates a session or re-sends the confirmation.
    const { data: existingSession } = await supabase
      .from("consultation_sessions")
      .select("id")
      .eq("booking_id", bookingId)
      .maybeSingle();

    if (!existingSession) {
      const doctor = await resolveTeleconsultDoctor(supabase);
      if (doctor) {
        try {
          await createTeleconsultSession(supabase, {
            bookingId,
            doctorId: doctor.id,
            dutyRoomUrl: doctor.duty_room_join_url,
            scheduledAtIso: scheduledForIso,
            customerId: customer.id,
            createdBy: null, // native path has no ops user (column is nullable)
          });
        } catch (sessionErr) {
          // Payment is captured + booking is saved — never 500 the client here.
          // Log loudly so ops can attach a session manually.
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
      const slotLine = `Scheduled for ${formatIstSlot(scheduledForIso)}. Your video link arrives ~10 min before.`;
      await sendBookingConfirmed({
        patientName: nameValidation.name,
        serviceSlug: "teleconsultation",
        bookingCode: bookingCode ?? "",
        patientPhone: customer.phone,
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
