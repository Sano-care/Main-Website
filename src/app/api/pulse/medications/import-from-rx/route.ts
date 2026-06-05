import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import { isUuid } from "../../_lib/validation";
import { addDaysYMD, istTodayYMD } from "../../_lib/ist";
import {
  expandIntakeLog,
  mapDuration,
  mapFrequency,
} from "../../_lib/medications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MED_SELECT =
  "id, name, dose, frequency_label, times_per_day, scheduled_times, start_date, end_date, reason, source, source_rx_id, imported_needs_review, refill_warning_threshold_days, supply_qty, supply_updated_at, created_at";

// POST /api/pulse/medications/import-from-rx?rx_id=
//
// Turn a prescription's line items into Pulse medications, then seed each
// one's 14-day intake log. The frequency/duration mapper is LOSSY (the Rx
// carries free text), so every imported row gets imported_needs_review=true —
// the synthesised IST clock times always warrant a patient glance. See
// T62 plan-of-record §3 for the locked mapping rules.
//
// Ownership: prescriptions JOIN bookings WHERE bookings.customer_id = me.
// A prescription that isn't the signed-in customer's is rejected with 404.

export async function POST(req: NextRequest) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  const rxId = req.nextUrl.searchParams.get("rx_id");
  if (!isUuid(rxId)) {
    return NextResponse.json(
      { error: "rx_id query param is required." },
      { status: 400 },
    );
  }

  // Ownership via the booking. `bookings!inner(customer_id)` joins through
  // prescriptions.booking_id; the .eq on the embedded column filters to the
  // signed-in customer, so someone else's Rx id yields no row.
  const { data: rx, error: rxErr } = await supabaseAdmin
    .from("prescriptions")
    .select("id, patient_name, sent_at, status, bookings!inner(customer_id)")
    .eq("id", rxId)
    .eq("bookings.customer_id", customer.id)
    .maybeSingle();

  if (rxErr) {
    console.error("[pulse/import-from-rx] rx lookup failed:", rxErr);
    return NextResponse.json(
      { error: "Could not load the prescription." },
      { status: 500 },
    );
  }
  if (!rx) {
    return NextResponse.json(
      { error: "Prescription not found." },
      { status: 404 },
    );
  }

  // Idempotency guard — don't double-import the same Rx for this customer.
  const { data: already, error: dupErr } = await supabaseAdmin
    .from("medications")
    .select("id")
    .eq("customer_id", customer.id)
    .eq("source_rx_id", rxId)
    .limit(1);
  if (dupErr) {
    console.error("[pulse/import-from-rx] dup check failed:", dupErr);
    return NextResponse.json(
      { error: "Could not import the prescription." },
      { status: 500 },
    );
  }
  if (already && already.length > 0) {
    return NextResponse.json(
      { error: "This prescription has already been imported." },
      { status: 409 },
    );
  }

  // Source line items.
  const { data: items, error: itemsErr } = await supabaseAdmin
    .from("prescription_items")
    .select("ordinal, drug_name, dose, frequency, duration, instructions")
    .eq("prescription_id", rxId)
    .order("ordinal", { ascending: true });
  if (itemsErr) {
    console.error("[pulse/import-from-rx] items load failed:", itemsErr);
    return NextResponse.json(
      { error: "Could not read the prescription items." },
      { status: 500 },
    );
  }
  if (!items || items.length === 0) {
    return NextResponse.json(
      { error: "This prescription has no medicines to import." },
      { status: 400 },
    );
  }

  const today = istTodayYMD();

  // Map each line item → a medication insert payload.
  const payloads = items.map((it) => {
    const freq = mapFrequency(it.frequency as string | null);
    const dur = mapDuration(it.duration as string | null);
    const endDate = dur.days != null ? addDaysYMD(today, dur.days) : null;

    // imported_needs_review whenever ANY field was synthesised. Clock times
    // are always synthesised (freq.heuristic), so this is effectively always
    // true at v0 — the patient confirms timing, then the pill clears on edit.
    const needsReview = freq.heuristic || dur.heuristic || endDate === null;

    return {
      customer_id: customer.id,
      name: (it.drug_name as string) || "Medicine",
      dose:
        typeof it.dose === "string" && it.dose.trim() !== ""
          ? it.dose.trim()
          : "As directed",
      frequency_label:
        typeof it.frequency === "string" && it.frequency.trim() !== ""
          ? it.frequency.trim()
          : "As directed",
      times_per_day: freq.timesPerDay,
      scheduled_times: freq.scheduledTimes,
      start_date: today,
      end_date: endDate,
      reason:
        typeof it.instructions === "string" && it.instructions.trim() !== ""
          ? it.instructions.trim().slice(0, 300)
          : null,
      source: "rx_import" as const,
      source_rx_id: rxId,
      imported_needs_review: needsReview,
    };
  });

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("medications")
    .insert(payloads)
    .select(MED_SELECT);
  if (insErr || !inserted) {
    console.error("[pulse/import-from-rx] med insert failed:", insErr);
    return NextResponse.json(
      { error: "Could not import the medicines." },
      { status: 500 },
    );
  }

  // Seed intake logs for every imported med.
  const logRows = inserted.flatMap((med) =>
    expandIntakeLog({
      medicationId: med.id as string,
      scheduledTimes: (med.scheduled_times as string[] | null) ?? [],
      startDate: (med.start_date as string | null) ?? null,
      endDate: (med.end_date as string | null) ?? null,
    }),
  );
  let intakeCount = 0;
  if (logRows.length > 0) {
    const { error: logErr } = await supabaseAdmin
      .from("medication_intake_log")
      .insert(logRows);
    if (logErr) {
      console.error("[pulse/import-from-rx] intake seed failed:", logErr);
    } else {
      intakeCount = logRows.length;
    }
  }

  return NextResponse.json(
    {
      imported: inserted.length,
      intake_count: intakeCount,
      medications: inserted,
      needs_review: inserted.filter((m) => m.imported_needs_review).length,
    },
    { status: 201 },
  );
}
