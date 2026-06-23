import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireMedic } from "@/lib/auth/requireMedic";
import {
  UUID_RE,
  isGdaTaskKey,
  isVitalTaskKey,
  parseVital,
} from "@/lib/gda/shared";

export const runtime = "nodejs";

// GDA Phase 1 (M064) — POST /api/medic-app/gda/checklist
//
// Body: { shift_id, task_key, value?, done }
//
// Upserts a single checklist task for the GDA's shift (UNIQUE(shift_id, task_key)).
// done=true stamps done_at=now; done=false clears it. `value` carries a reading
// for vital tasks (bp/pulse/sugar/temperature) or a free note otherwise.
// Cookie-auth; the shift must belong to the cookied GDA.
//
// Vitals mirror (C5): when a vital task (bp/pulse/sugar/temperature) is marked
// done with a parseable reading AND the deployment is linked to a real customer,
// the reading is also written to vital_readings (omit unit → DB default 'auto';
// source='device'). Unparseable readings or unlinked deployments save the
// checklist row only — never block the GDA's flow.

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(request: NextRequest) {
  const auth = await requireMedic(request);
  if (auth instanceof NextResponse) return auth;

  let body: {
    shift_id?: string;
    task_key?: string;
    value?: unknown;
    done?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const shiftId = String(body.shift_id ?? "");
  if (!UUID_RE.test(shiftId)) {
    return NextResponse.json({ error: "invalid_shift_id" }, { status: 400 });
  }
  const taskKey = String(body.task_key ?? "");
  if (!isGdaTaskKey(taskKey)) {
    return NextResponse.json({ error: "invalid_task_key" }, { status: 400 });
  }
  const done = body.done === true;
  const value =
    typeof body.value === "string" && body.value.trim() !== ""
      ? body.value.trim().slice(0, 200)
      : null;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  // Ownership — the GDA can only write checklist rows for their own shift.
  const { data: shift, error: lookupErr } = await supabase
    .from("gda_shifts")
    .select("id, deployment_id")
    .eq("id", shiftId)
    .eq("gda_id", auth.medic_id)
    .maybeSingle();
  if (lookupErr) {
    console.error("[medic-app/gda/checklist] lookup failed", lookupErr);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!shift) {
    return NextResponse.json({ error: "shift_not_found" }, { status: 404 });
  }

  // The linked deployment's customer_id drives the vitals mirror (null → checklist-only).
  const { data: deployment } = await supabase
    .from("gda_deployments")
    .select("customer_id")
    .eq("id", shift.deployment_id)
    .maybeSingle();
  const customerId =
    (deployment as { customer_id: string | null } | null)?.customer_id ?? null;

  const { error: upsertErr } = await supabase
    .from("gda_shift_checklist")
    .upsert(
      {
        shift_id: shiftId,
        task_key: taskKey,
        value,
        done_at: done ? new Date().toISOString() : null,
      },
      { onConflict: "shift_id,task_key" },
    );
  if (upsertErr) {
    console.error("[medic-app/gda/checklist] upsert failed", upsertErr);
    return NextResponse.json(
      { error: "upsert_failed", detail: upsertErr.message },
      { status: 500 },
    );
  }

  // Vitals mirror — only for a completed vital task with a parseable reading on a
  // customer-linked deployment. Anything else is checklist-only (no error).
  let vitalMirrored = false;
  if (done && isVitalTaskKey(taskKey) && value && customerId) {
    const parsed = parseVital(taskKey, value);
    if (parsed) {
      const { error: vitalErr } = await supabase.from("vital_readings").insert({
        customer_id: customerId,
        kind: parsed.kind,
        value_numeric: parsed.value_numeric,
        value_secondary: parsed.value_secondary,
        taken_at: new Date().toISOString(),
        source: "device",
        // unit omitted → DB default 'auto'.
      });
      if (vitalErr) {
        // Records-side best-effort: the checklist row is saved either way.
        console.error("[medic-app/gda/checklist] vital mirror failed", vitalErr);
      } else {
        vitalMirrored = true;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    task_key: taskKey,
    done,
    vital_mirrored: vitalMirrored,
  });
}
