import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOpsAdminApi } from "@/app/ops/_lib/requireOpsAdmin";

export const runtime = "nodejs";

// GDA Phase 1 (M064) + GDA onboarding — POST /api/ops/gda/staff
//
// Onboard a GDA: a `medics` row with staff_type='gda'. Admin only; identity from
// the ops session, never the body.
//
// A GDA needs NO qualification (founder, 2026-06-23) — qualification stays NULL,
// distinct from nurses (GNM/B.Sc). A GDA is paid a DAILY wage by shift kind, so we
// capture per-GDA default rates (rate_day12/night12/full24), a home address, a
// shift preference, and an onboarding documents-consent stamp. The ID documents
// themselves (Aadhaar/PAN/photo/address_proof) are uploaded separately to the
// access-logged private bucket via /api/ops/medics/[id]/docs after this returns
// the new GDA's id — we never store the raw ID number as text.

const PHONE_RE = /^\+91[6-9]\d{9}$/;
const SHIFT_PREFS = new Set(["day12", "night12", "full24", "any"]);

function rupeesToPaiseOrNull(v: unknown): number | null | "invalid" {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return Math.round(n * 100);
}

export async function POST(request: NextRequest) {
  const gate = await requireOpsAdminApi();
  if (gate instanceof NextResponse) return gate;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const fullName = String(body.full_name ?? "").trim();
  if (fullName.length < 2 || fullName.length > 80) {
    return NextResponse.json(
      { error: "invalid_full_name", detail: "2–80 characters." },
      { status: 400 },
    );
  }

  const phone = String(body.phone ?? "").trim();
  if (!PHONE_RE.test(phone)) {
    return NextResponse.json(
      { error: "invalid_phone", detail: "E.164 Indian mobile (+91XXXXXXXXXX)." },
      { status: 400 },
    );
  }

  // No qualification for GDAs — left NULL by design.

  const homeAddressRaw = String(body.home_address ?? "").trim();
  const homeAddress = homeAddressRaw.length > 0 ? homeAddressRaw.slice(0, 500) : null;

  let shiftPreference: string | null = null;
  if (body.shift_preference != null && String(body.shift_preference).length > 0) {
    shiftPreference = String(body.shift_preference);
    if (!SHIFT_PREFS.has(shiftPreference)) {
      return NextResponse.json(
        { error: "invalid_shift_preference", detail: "day12, night12, full24, or any." },
        { status: 400 },
      );
    }
  }

  const rateDay12 = rupeesToPaiseOrNull(body.rate_day12_rupees);
  const rateNight12 = rupeesToPaiseOrNull(body.rate_night12_rupees);
  const rateFull24 = rupeesToPaiseOrNull(body.rate_full24_rupees);
  if (rateDay12 === "invalid" || rateNight12 === "invalid" || rateFull24 === "invalid") {
    return NextResponse.json({ error: "invalid_rate" }, { status: 400 });
  }

  const insulinMedCleared = body.insulin_med_cleared === true;

  // Documents consent — stamped now when the admin confirms the GDA consented to
  // their IDs being stored (DPDP). The images are uploaded right after.
  const documentsConsentAt =
    body.documents_consent === true ? new Date().toISOString() : null;

  // Belt + braces dupe check (DB also enforces phone uniqueness).
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from("medics")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  if (lookupErr) {
    console.error("[ops/gda/staff] phone lookup failed", lookupErr);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json(
      { error: "phone_taken", detail: "This phone is already a medic." },
      { status: 409 },
    );
  }

  const { data: created, error: insertErr } = await supabaseAdmin
    .from("medics")
    .insert({
      full_name: fullName,
      phone,
      // qualification + license_number stay NULL (GDA, not a nurse).
      // photo_url stays NULL — the photo lives as an access-logged 'photo' doc.
      staff_type: "gda",
      insulin_med_cleared: insulinMedCleared,
      home_address: homeAddress,
      shift_preference: shiftPreference,
      documents_consent_at: documentsConsentAt,
      rate_day12_paise: rateDay12,
      rate_night12_paise: rateNight12,
      rate_full24_paise: rateFull24,
    })
    .select("id, full_name, phone, staff_type")
    .single();
  if (insertErr || !created) {
    console.error("[ops/gda/staff] insert failed", insertErr);
    return NextResponse.json(
      { error: "insert_failed", detail: insertErr?.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ gda: created }, { status: 201 });
}

// GET /api/ops/gda/staff — list GDAs (for the assign-shift picker). Admin only.
// Returns shift_preference + the per-kind rates so the scheduler can honor the
// preference and default a shift's payout from the GDA's rate.
export async function GET() {
  const gate = await requireOpsAdminApi();
  if (gate instanceof NextResponse) return gate;

  const { data, error } = await supabaseAdmin
    .from("medics")
    .select(
      "id, full_name, phone, active, shift_preference, rate_day12_paise, rate_night12_paise, rate_full24_paise",
    )
    .eq("staff_type", "gda")
    .order("full_name", { ascending: true });
  if (error) {
    console.error("[ops/gda/staff] list failed", error);
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  return NextResponse.json({ gdas: data ?? [] });
}
