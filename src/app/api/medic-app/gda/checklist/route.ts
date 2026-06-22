import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireMedic } from "@/lib/auth/requireMedic";
import { UUID_RE, isGdaTaskKey } from "@/lib/gda/shared";

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
// The vitals mirror (vital task_keys → vital_readings) is wired in C5 — this
// commit persists the checklist row only.

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

  return NextResponse.json({ ok: true, task_key: taskKey, done });
}
