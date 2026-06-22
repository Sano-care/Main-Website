import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOpsAdminApi } from "@/app/ops/_lib/requireOpsAdmin";

export const runtime = "nodejs";

// GDA Phase 1 (M064) — POST /api/ops/gda/staff
//
// Create a GDA: a `medics` row with staff_type='gda' and the D2a
// insulin_med_cleared competency flag. Admin only. Identity (created context)
// comes from the ops session, never the body.
//
// A GDA shares the medic stack — phone+OTP login, attendance, ledger — so this
// reuses the medics table rather than forking a parallel staff table. The only
// discriminator is staff_type (D6: no new service_category, no new identity).

const PHONE_RE = /^\+91[6-9]\d{9}$/;
const QUALIFICATIONS = new Set(["GNM", "B.Sc Nursing"]);

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

  // Medics are GNM / B.Sc Nursing (house rule). A GDA is still nursing-trained.
  const qualification = String(body.qualification ?? "").trim();
  if (!QUALIFICATIONS.has(qualification)) {
    return NextResponse.json(
      { error: "invalid_qualification", detail: "GNM or B.Sc Nursing." },
      { status: 400 },
    );
  }

  const insulinMedCleared = body.insulin_med_cleared === true;

  const licenseRaw = String(body.license_number ?? "").trim();
  const licenseNumber = licenseRaw.length > 0 ? licenseRaw : null;

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
      qualification,
      license_number: licenseNumber,
      staff_type: "gda",
      insulin_med_cleared: insulinMedCleared,
    })
    .select("id, full_name, phone, staff_type, insulin_med_cleared")
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
export async function GET() {
  const gate = await requireOpsAdminApi();
  if (gate instanceof NextResponse) return gate;

  const { data, error } = await supabaseAdmin
    .from("medics")
    .select("id, full_name, phone, insulin_med_cleared, active")
    .eq("staff_type", "gda")
    .order("full_name", { ascending: true });
  if (error) {
    console.error("[ops/gda/staff] list failed", error);
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  return NextResponse.json({ gdas: data ?? [] });
}
