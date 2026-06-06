import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import {
  addDaysYMD,
  istTodayYMD,
  istWallTimeToUtc,
} from "@/app/api/pulse/_lib/ist";
import type {
  ImportableRx,
  RecentActivityItem,
  ScheduledDose,
  VitalReading,
} from "./pulseTypes";

// Server-side read helpers shared by the Pulse home (server component) and the
// two supporting read routes (…/medications/schedule, …/medications/importable-rx).
// Centralising the queries here means the SSR home and the client surfaces see
// exactly the same "today's doses" / "importable Rx" logic — one source of truth.
//
// Every function is customer-scoped: the caller resolves the signed-in
// customer (PulseShell / requirePulseCustomer) and passes the id in. No
// function here trusts a cookie itself.

const MED_ACTIVE_SELECT = "id, name, dose, scheduled_times, end_date";

/** Half-open today-in-IST window as UTC ISO bounds: [start, nextDayStart). */
function istTodayBoundsUtc(): { fromIso: string; toIso: string } | null {
  const today = istTodayYMD();
  const from = istWallTimeToUtc(today, "00:00");
  const to = istWallTimeToUtc(addDaysYMD(today, 1), "00:00");
  if (!from || !to) return null;
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

/**
 * Today's doses across the customer's active medications, newest scheduled
 * slot last. Joins each intake-log row to its medication's name + dose.
 */
export async function getTodaySchedule(
  customerId: string,
): Promise<ScheduledDose[]> {
  const bounds = istTodayBoundsUtc();
  if (!bounds) return [];
  const today = istTodayYMD();

  const { data: meds, error: medsErr } = await supabaseAdmin
    .from("medications")
    .select(MED_ACTIVE_SELECT)
    .eq("customer_id", customerId)
    .or(`end_date.is.null,end_date.gte.${today}`);
  if (medsErr) {
    console.error("[pulse/data] today-schedule meds load failed:", medsErr);
    return [];
  }
  const medList = meds ?? [];
  if (medList.length === 0) return [];

  const metaById = new Map<string, { name: string; dose: string }>(
    medList.map((m) => [
      m.id as string,
      { name: (m.name as string) ?? "", dose: (m.dose as string) ?? "" },
    ]),
  );
  const ids = medList.map((m) => m.id as string);

  const { data: rows, error: logErr } = await supabaseAdmin
    .from("medication_intake_log")
    .select("id, medication_id, scheduled_at, state, taken_at")
    .in("medication_id", ids)
    .gte("scheduled_at", bounds.fromIso)
    .lt("scheduled_at", bounds.toIso)
    .order("scheduled_at", { ascending: true });
  if (logErr) {
    console.error("[pulse/data] today-schedule log load failed:", logErr);
    return [];
  }

  return (rows ?? []).map((r) => {
    const meta = metaById.get(r.medication_id as string);
    return {
      intake_id: r.id as string,
      medication_id: r.medication_id as string,
      name: meta?.name ?? "",
      dose: meta?.dose ?? "",
      scheduled_at: r.scheduled_at as string,
      state: (r.state as ScheduledDose["state"]) ?? "pending",
      taken_at: (r.taken_at as string | null) ?? null,
    };
  });
}

/**
 * The most recent Sanocare prescription the customer could import: status
 * 'sent', sent within the last 7 days, not already imported into medications.
 * Returns null when there's nothing to offer. (T62 plan-of-record §3.)
 */
export async function getImportableRx(
  customerId: string,
): Promise<ImportableRx | null> {
  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Candidate recent sent prescriptions owned by this customer (via booking),
  // with a line-item count. The doctor name is resolved separately — there are
  // two FKs from prescriptions to doctors (doctor_id + created_by_doctor_id),
  // so an embedded `doctors(...)` would be ambiguous.
  // prescription_items(count) gives the line-item count per Rx; the JS count>0
  // guard below filters out empty Rxs so the import banner only offers a
  // prescription that actually has medicines to import. (This keeps the exact
  // PostgREST embed that's already proven in prod and applies the EXISTS as a
  // guard on the fetched count — equivalent outcome, no inner-join-aggregate
  // surprises.)
  const { data: candidates, error: candErr } = await supabaseAdmin
    .from("prescriptions")
    .select(
      "id, sent_at, doctor_id, bookings!inner(customer_id), prescription_items(count)",
    )
    .eq("bookings.customer_id", customerId)
    .eq("status", "sent")
    .gte("sent_at", sevenDaysAgo)
    .order("sent_at", { ascending: false })
    .limit(10);
  if (candErr) {
    console.error("[pulse/data] importable-rx candidates failed:", candErr);
    return null;
  }
  if (!candidates || candidates.length === 0) return null;

  // Exclude any Rx already imported by this customer.
  const candidateIds = candidates.map((c) => c.id as string);
  const { data: imported, error: impErr } = await supabaseAdmin
    .from("medications")
    .select("source_rx_id")
    .eq("customer_id", customerId)
    .in("source_rx_id", candidateIds);
  if (impErr) {
    console.error("[pulse/data] importable-rx imported check failed:", impErr);
    return null;
  }
  const importedSet = new Set(
    (imported ?? [])
      .map((m) => m.source_rx_id as string | null)
      .filter((v): v is string => !!v),
  );

  // Supabase renders the prescription_items aggregate as a 1-element array.
  const itemCountOf = (c: { prescription_items?: unknown }): number => {
    const pi = c.prescription_items;
    const row = Array.isArray(pi)
      ? (pi[0] as { count?: number } | undefined)
      : (pi as { count?: number } | null);
    return Number(row?.count ?? 0);
  };

  // First un-imported candidate that actually has items (guards the edge where
  // !inner ever lets a zero through, and is the authoritative "offer it?" check).
  const fresh = candidates.find(
    (c) => !importedSet.has(c.id as string) && itemCountOf(c) > 0,
  );
  if (!fresh) return null;

  return {
    id: fresh.id as string,
    doctor_name: await doctorName(fresh.doctor_id as string | null),
    sent_at: (fresh.sent_at as string | null) ?? null,
    item_count: itemCountOf(fresh),
  };
}

/** Resolve a doctor's full name by id, or null. Cheap point lookup. */
async function doctorName(doctorId: string | null): Promise<string | null> {
  if (!doctorId) return null;
  const { data } = await supabaseAdmin
    .from("doctors")
    .select("full_name")
    .eq("id", doctorId)
    .maybeSingle();
  return (data?.full_name as string | null) ?? null;
}

/**
 * Latest reading per kind for the home "Today's vitals" tile. Pulls the most
 * recent readings and keeps the first (newest) seen for each kind.
 */
export async function getLatestVitalsByKind(
  customerId: string,
): Promise<VitalReading[]> {
  const { data, error } = await supabaseAdmin
    .from("vital_readings")
    .select(
      "id, kind, value_numeric, value_secondary, unit, taken_at, context_note, source, created_at",
    )
    .eq("customer_id", customerId)
    .order("taken_at", { ascending: false })
    .limit(60);
  if (error) {
    console.error("[pulse/data] latest-vitals load failed:", error);
    return [];
  }

  const seen = new Set<string>();
  const latest: VitalReading[] = [];
  for (const r of data ?? []) {
    const kind = r.kind as string;
    if (seen.has(kind)) continue;
    seen.add(kind);
    latest.push(r as unknown as VitalReading);
  }
  return latest;
}

/**
 * Recent sent prescriptions for the home "Recent activity" card. Lab results
 * are intentionally omitted — the lab_orders/lab_results tables aren't built
 * yet (the records-architecture diagram lists them as future M-track work), so
 * surfacing them now would be fiction. Prescriptions are real and joinable.
 */
export async function getRecentActivity(
  customerId: string,
  limit = 4,
): Promise<RecentActivityItem[]> {
  const { data, error } = await supabaseAdmin
    .from("prescriptions")
    .select(
      "id, sent_at, patient_view_token, doctor_id, bookings!inner(customer_id)",
    )
    .eq("bookings.customer_id", customerId)
    .eq("status", "sent")
    .order("sent_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[pulse/data] recent-activity load failed:", error);
    return [];
  }
  const rows = data ?? [];
  if (rows.length === 0) return [];

  // Resolve doctor names in one batch (two doctor FKs on prescriptions make an
  // embedded join ambiguous — see getImportableRx).
  const doctorIds = Array.from(
    new Set(rows.map((r) => r.doctor_id as string | null).filter(Boolean)),
  ) as string[];
  const nameById = new Map<string, string>();
  if (doctorIds.length > 0) {
    const { data: docs } = await supabaseAdmin
      .from("doctors")
      .select("id, full_name")
      .in("id", doctorIds);
    for (const d of docs ?? []) {
      nameById.set(d.id as string, (d.full_name as string | null) ?? "");
    }
  }

  return rows.map((r) => {
    const name = r.doctor_id ? (nameById.get(r.doctor_id as string) ?? null) : null;
    return {
      id: r.id as string,
      kind: "prescription" as const,
      title: name ? `Prescription from Dr ${name}` : "Prescription",
      doctor_name: name,
      when: (r.sent_at as string | null) ?? null,
      patient_view_token: (r.patient_view_token as string | null) ?? null,
    };
  });
}
