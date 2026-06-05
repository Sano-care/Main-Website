import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import { windowToMs } from "../../_lib/window";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/pulse/medications/adherence?window=
//
// Adherence over a rolling window across all the customer's meds, counting
// only DUE doses (scheduled_at <= now). A still-"pending" dose whose time has
// passed counts as a miss for the rate (the patient never marked it), but is
// reported separately as `overdue_pending` so the UI can nudge rather than
// scold. Deliberately-skipped doses are excluded from the denominator.
//
//   rate = taken / (taken + missed + overdue_pending)
//
// NOTE: static segment — wins over the sibling "[id]" dynamic route.

interface Tally {
  taken: number;
  skipped: number;
  missed: number;
  overdue_pending: number;
  due_total: number;
}

function emptyTally(): Tally {
  return { taken: 0, skipped: 0, missed: 0, overdue_pending: 0, due_total: 0 };
}

function rateOf(t: Tally): number | null {
  const denom = t.taken + t.missed + t.overdue_pending;
  if (denom === 0) return null;
  return Math.round((t.taken / denom) * 1000) / 1000;
}

export async function GET(req: NextRequest) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  const windowParam = req.nextUrl.searchParams.get("window") ?? "30d";
  const ms = windowToMs(windowParam);
  if (ms === null) {
    return NextResponse.json(
      { error: "window must be one of 7d, 14d, 30d, 90d, 180d, 1y." },
      { status: 400 },
    );
  }
  const nowIso = new Date().toISOString();
  const fromIso = new Date(Date.now() - ms).toISOString();

  // The customer's meds (id + name for the per-med breakdown).
  const { data: meds, error: medsErr } = await supabaseAdmin
    .from("medications")
    .select("id, name")
    .eq("customer_id", customer.id);
  if (medsErr) {
    console.error("[pulse/medications/adherence] meds load failed:", medsErr);
    return NextResponse.json(
      { error: "Could not compute adherence." },
      { status: 500 },
    );
  }

  const medList = meds ?? [];
  if (medList.length === 0) {
    return NextResponse.json({
      window: windowParam,
      overall: { ...emptyTally(), rate: null },
      per_medication: [],
    });
  }

  const nameById = new Map<string, string>(
    medList.map((m) => [m.id as string, (m.name as string) ?? ""]),
  );
  const ids = medList.map((m) => m.id as string);

  // Due doses in the window: scheduled_at within [from, now].
  const { data: rows, error: logErr } = await supabaseAdmin
    .from("medication_intake_log")
    .select("medication_id, state, scheduled_at")
    .in("medication_id", ids)
    .gte("scheduled_at", fromIso)
    .lte("scheduled_at", nowIso);
  if (logErr) {
    console.error("[pulse/medications/adherence] log load failed:", logErr);
    return NextResponse.json(
      { error: "Could not compute adherence." },
      { status: 500 },
    );
  }

  const overall = emptyTally();
  const perMed = new Map<string, Tally>();
  for (const id of ids) perMed.set(id, emptyTally());

  for (const r of rows ?? []) {
    const medId = r.medication_id as string;
    const t = perMed.get(medId);
    if (!t) continue;
    const state = r.state as string;
    if (state === "taken") {
      t.taken++;
      overall.taken++;
    } else if (state === "skipped") {
      t.skipped++;
      overall.skipped++;
    } else if (state === "missed") {
      t.missed++;
      overall.missed++;
    } else {
      // pending, but scheduled_at <= now → overdue (an un-marked dose).
      t.overdue_pending++;
      overall.overdue_pending++;
    }
    t.due_total++;
    overall.due_total++;
  }

  const perMedicationOut = ids
    .map((id) => {
      const t = perMed.get(id)!;
      return {
        medication_id: id,
        name: nameById.get(id) ?? "",
        ...t,
        rate: rateOf(t),
      };
    })
    // Only surface meds that actually had due doses in the window.
    .filter((m) => m.due_total > 0);

  return NextResponse.json({
    window: windowParam,
    overall: { ...overall, rate: rateOf(overall) },
    per_medication: perMedicationOut,
  });
}
