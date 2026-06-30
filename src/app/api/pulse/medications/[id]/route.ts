import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import { isUuid } from "../../_lib/validation";
import { expandIntakeLog, normaliseScheduledTimes } from "../../_lib/medications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MED_SELECT =
  "id, name, dose, frequency_label, times_per_day, scheduled_times, start_date, end_date, reason, source, source_rx_id, imported_needs_review, refill_warning_threshold_days, supply_qty, supply_updated_at, created_at";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/pulse/medications/:id  — edit one of the caller's own meds.
 *
 * Editing the schedule (times_per_day / scheduled_times / end_date) clears
 * imported_needs_review — the patient has now confirmed those values, so the
 * "Review" pill goes away (per the M036 column comment) — and regenerates the
 * future pending intake-log rows so the schedule the patient sees matches
 * what they just set. Past + already-actioned (taken/skipped/missed) rows are
 * never touched.
 */
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid medication id." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if ("name" in body) {
    const v = typeof body.name === "string" ? body.name.trim() : "";
    if (!v) return badField("name");
    patch.name = v;
  }
  if ("dose" in body) {
    const v = typeof body.dose === "string" ? body.dose.trim() : "";
    if (!v) return badField("dose");
    patch.dose = v;
  }
  if ("frequency_label" in body) {
    const v =
      typeof body.frequency_label === "string" ? body.frequency_label.trim() : "";
    if (!v) return badField("frequency_label");
    patch.frequency_label = v;
  }
  if ("times_per_day" in body) {
    const n = Number(body.times_per_day);
    if (!Number.isInteger(n) || n < 0 || n > 6) {
      return NextResponse.json(
        { error: "times_per_day must be an integer 0–6." },
        { status: 400 },
      );
    }
    patch.times_per_day = n;
  }
  if ("scheduled_times" in body) {
    patch.scheduled_times = normaliseScheduledTimes(body.scheduled_times);
  }
  if ("start_date" in body) {
    if (typeof body.start_date !== "string" || !YMD_RE.test(body.start_date)) {
      return badField("start_date");
    }
    patch.start_date = body.start_date;
  }
  if ("end_date" in body) {
    if (body.end_date === null) {
      patch.end_date = null;
    } else if (typeof body.end_date === "string" && YMD_RE.test(body.end_date)) {
      patch.end_date = body.end_date;
    } else {
      return badField("end_date");
    }
  }
  if ("reason" in body) {
    patch.reason =
      typeof body.reason === "string" && body.reason.trim() !== ""
        ? body.reason.trim().slice(0, 300)
        : null;
  }
  if ("refill_warning_threshold_days" in body) {
    const n = Number(body.refill_warning_threshold_days);
    if (!Number.isInteger(n) || n < 0 || n > 90) {
      return NextResponse.json(
        { error: "refill_warning_threshold_days must be an integer 0–90." },
        { status: 400 },
      );
    }
    patch.refill_warning_threshold_days = n;
  }
  if ("supply_qty" in body) {
    if (body.supply_qty === null) {
      patch.supply_qty = null;
    } else {
      const n = Number(body.supply_qty);
      if (!Number.isInteger(n) || n < 0) return badField("supply_qty");
      patch.supply_qty = n;
      patch.supply_updated_at = new Date().toISOString();
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "No editable fields supplied." },
      { status: 400 },
    );
  }

  // A schedule edit means the patient has reviewed the timing → clear the
  // review pill.
  const scheduleTouched =
    "times_per_day" in patch ||
    "scheduled_times" in patch ||
    "end_date" in patch ||
    "start_date" in patch;
  if (scheduleTouched) {
    patch.imported_needs_review = false;
  }

  const { data: med, error } = await supabaseAdmin
    .from("medications")
    .update(patch)
    .eq("id", id)
    .eq("customer_id", customer.id)
    .select(MED_SELECT)
    .maybeSingle();

  if (error) {
    console.error("[pulse/medications/:id] PATCH failed:", error);
    return NextResponse.json(
      { error: "Could not update the medication." },
      { status: 500 },
    );
  }
  if (!med) {
    return NextResponse.json({ error: "Medication not found." }, { status: 404 });
  }

  // Regenerate future pending intake rows so the visible schedule matches.
  let regenerated = 0;
  if (scheduleTouched) {
    const nowIso = new Date().toISOString();
    // Drop only still-pending future doses; preserve history + actioned rows.
    const { error: delErr } = await supabaseAdmin
      .from("medication_intake_log")
      .delete()
      .eq("medication_id", id)
      .eq("state", "pending")
      .gte("scheduled_at", nowIso);
    if (delErr) {
      console.error("[pulse/medications/:id] intake purge failed:", delErr);
    }

    const rows = expandIntakeLog({
      medicationId: id,
      scheduledTimes: normaliseScheduledTimes(med.scheduled_times),
      startDate: (med.start_date as string | null) ?? null,
      endDate: (med.end_date as string | null) ?? null,
    });
    if (rows.length > 0) {
      const { error: insErr } = await supabaseAdmin
        .from("medication_intake_log")
        .insert(rows);
      if (insErr) {
        console.error("[pulse/medications/:id] intake regen failed:", insErr);
      } else {
        regenerated = rows.length;
      }
    }
  }

  return NextResponse.json({ medication: med, intake_regenerated: regenerated });
}

/**
 * DELETE /api/pulse/medications/:id — remove one of the caller's OWN
 * self-entered medications. Scoped to customer_id AND source='manual', so a
 * clinician/imported med (source='rx_import') or another customer's row affects
 * zero rows → 404. The medication_intake_log rows are removed automatically by
 * the ON DELETE CASCADE FK.
 */
export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid medication id." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("medications")
    .delete()
    .eq("id", id)
    .eq("customer_id", customer.id)
    .eq("source", "manual")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[pulse/medications/:id] DELETE failed:", error);
    return NextResponse.json(
      { error: "Could not delete the medication." },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: "Not found, or it isn't one you can remove." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, id: data.id });
}

function badField(field: string): NextResponse {
  return NextResponse.json(
    { error: `Invalid value for ${field}.` },
    { status: 400 },
  );
}
