import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  VERIFY_COOKIE_NAME,
  normaliseIndianPhone,
  verifyToken,
} from "@/lib/otp/token";

export const runtime = "nodejs";

/**
 * POST /api/lab/create-booking
 *
 * Creates a lab-diagnostics booking (free home collection, pay-after-report).
 * Replaces the previous client-side supabase.insert path so we can enforce
 * the OTP verification cookie before any row lands in `bookings`.
 *
 * Body:
 *   {
 *     patient_name, phone, manual_address,
 *     gps_location?: { lat, lng, accuracy },
 *     selected_tests: Array<{ code, name, price, sample, tat, category }>,
 *     applied_coupon?: { code, discount_percent, discount_inr }
 *   }
 *
 * Returns:
 *   200 { ok: true, bookingId }
 *   400 { error }
 *   401 { error }  — OTP cookie missing / phone mismatch
 *   500 { error }
 */
export async function POST(req: NextRequest) {
  let body: {
    patient_name?: string;
    phone?: string;
    manual_address?: string;
    gps_location?: { lat: number; lng: number; accuracy: number } | null;
    selected_tests?: Array<{
      code: string;
      name: string;
      price: number;
      sample?: string;
      tat?: string;
      category?: string;
    }>;
    applied_coupon?: { code: string; discount_percent: number; discount_inr: number } | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // === OTP verification gate ===
  const verifyCookie = req.cookies.get(VERIFY_COOKIE_NAME)?.value;
  const verified = verifyToken(verifyCookie);
  if (!verified) {
    return NextResponse.json(
      { error: "Phone verification required. Please request a code first." },
      { status: 401 },
    );
  }
  const submittedPhone = normaliseIndianPhone(String(body.phone ?? ""));
  if (!submittedPhone || submittedPhone !== verified.phone) {
    return NextResponse.json(
      { error: "Booking phone does not match the verified number. Please re-verify." },
      { status: 401 },
    );
  }

  // === Field validation ===
  const patientName = String(body.patient_name ?? "").trim();
  const address = String(body.manual_address ?? "").trim();
  if (!patientName) {
    return NextResponse.json({ error: "Patient name is required." }, { status: 400 });
  }
  if (address.length < 10) {
    return NextResponse.json({ error: "Address is too short." }, { status: 400 });
  }
  const tests = Array.isArray(body.selected_tests) ? body.selected_tests : [];
  if (tests.length === 0) {
    return NextResponse.json(
      { error: "Please pick at least one lab test before booking." },
      { status: 400 },
    );
  }

  // === Pricing snapshot (mirrors the previous client-side calc) ===
  const testTotalRupees = tests.reduce((sum, t) => sum + (Number(t.price) || 0), 0);
  const testTotalPaise = testTotalRupees * 100;
  const couponDiscountPaise = body.applied_coupon
    ? Math.round(body.applied_coupon.discount_inr * 100)
    : 0;
  const finalAmountPaise = Math.max(0, testTotalPaise - couponDiscountPaise);

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Server is misconfigured." },
      { status: 500 },
    );
  }

  // If the patient's browser couldn't (or wouldn't) share their location,
  // mark the booking so ops knows to collect address from them before the
  // phlebo is dispatched. Never block the booking on a declined permission.
  const opsNotesMarker = body.gps_location
    ? null
    : "📍 Location auto-capture declined or unavailable — confirm address with patient before dispatch.";

  const { data, error } = await supabase
    .from("bookings")
    .insert({
      patient_name: patientName,
      phone: submittedPhone,
      service_category: "diagnostics",
      manual_address: address,
      gps_location: body.gps_location ?? null,
      ops_notes: opsNotesMarker,
      status: "PENDING_COLLECTION",
      amount: 0,
      selected_tests: tests,
      test_total_paise: testTotalPaise,
      applied_coupon_code: body.applied_coupon?.code ?? null,
      coupon_discount_percent: body.applied_coupon?.discount_percent ?? null,
      coupon_discount_paise: couponDiscountPaise || null,
      final_amount_paise: finalAmountPaise,
      lab_partner: "pathcore",
      report_payment_status: "NOT_DUE",
      otp_verified_at: new Date(verified.verifiedAt * 1000).toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("[lab/create-booking] insert failed:", error);
    return NextResponse.json(
      { error: "Could not save booking. Please call +91-9711977782." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, bookingId: data?.id });
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
