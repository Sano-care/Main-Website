import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import {
  AuditEvent,
  writeAudit,
  type AuditIdentity,
} from "@/lib/whatsapp/safety/audit";

// ---------------------------------------------------------------------------
// Pulse Records data layer — Slice A.
//
// The single, shared read contract behind the Pulse signed-in "Your records"
// experience. Both consumers call THIS:
//   * Slice B — the Pulse web UI (server components, customer from
//     getCurrentCustomer()).
//   * Slice C — Aarogya's `fetch_pulse_records` tool (customer from the
//     adapter-injected resolveIdentity()).
//
// Hard rules baked in here so neither consumer can get them wrong:
//   1. ACCOUNT-SCOPED. Every query is filtered by the `customerId` the caller
//      passes in. That id comes from a verified session (Pulse cookie) or the
//      adapter-injected identity (Aarogya) — NEVER from model/tool input or a
//      request body. This module does not read cookies or trust any other id.
//   2. AUDITED (DPDP). Every call writes exactly one audit_log row, identity-
//      aware and phone-free: it records WHO accessed, the member scope, the
//      categories, and per-category COUNTS — never the record contents.
//   3. Best-effort reads. A failing category resolves to [] (logged), matching
//      the established pulseData.ts posture; one bad table never blanks the page.
//
// This lib lives under src/lib (not src/app) on purpose: it is the lower layer
// that the app UI and the Aarogya runtime both depend on, so it must not import
// from either.
// ---------------------------------------------------------------------------

export type RecordCategory =
  | "bookings"
  | "prescriptions"
  | "vitals"
  | "medications"
  | "conditions"
  | "allergies"
  | "documents";

export const ALL_RECORD_CATEGORIES: RecordCategory[] = [
  "bookings",
  "prescriptions",
  "vitals",
  "medications",
  "conditions",
  "allergies",
  "documents",
];

/**
 * vital_readings + medications are account-level only this slice (no member_id
 * column — see the tracked per-member-vitals follow-up). When the caller asks
 * for ONE specific family member, these two cannot be attributed to that member
 * and are intentionally omitted (reported via `accountLevelOmitted`).
 */
const ACCOUNT_LEVEL_CATEGORIES: RecordCategory[] = ["vitals", "medications"];

const DEFAULT_LIMIT = 50;

export interface PulseRecordsFilter {
  /**
   * Subject filter:
   *  - `undefined` → all subjects on the account (holder + every member)
   *  - `null`      → the account holder only (member_id IS NULL)
   *  - `string`    → that one family member (member_id = uuid)
   */
  memberId?: string | null;
  /** Restrict to a subset of categories. Default: all seven. */
  categories?: RecordCategory[];
  /** Per-category row cap. Default 50. Keeps a chat-tool response bounded. */
  limit?: number;
}

export interface PulseRecordsAudit {
  /**
   * Phone-free caller identity. On the Aarogya side use identityForAudit().
   * On the Pulse side build `{ role: "customer", identifiers: { customer_id } }`.
   */
  identity: AuditIdentity;
  /** Surface the access channel in the audit row. */
  accessor: "pulse" | "aarogya";
  /** WhatsApp conversation id when called from Aarogya; null on the Pulse side. */
  conversationId?: string | null;
}

export interface ConditionRecord {
  id: string;
  member_id: string | null;
  label: string;
  status: string;
  source: string;
  noted_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AllergyRecord extends ConditionRecord {
  severity: string;
  reaction: string | null;
}

/** Vault metadata only — never the storage path or a signed URL (Slice C mints those). */
export interface DocumentRecord {
  id: string;
  member_id: string | null;
  doc_type: string;
  label: string | null;
  mime_type: string;
  file_size_bytes: number;
  source: string;
  uploaded_at: string;
}

export interface BookingRecord {
  id: string;
  member_id: string | null;
  service_category: string | null;
  status: string;
  scheduled_for: string | null;
  created_at: string;
}

export interface PrescriptionRecord {
  id: string;
  doctor_name: string | null;
  sent_at: string | null;
  patient_view_token: string | null;
}

export interface VitalRecord {
  id: string;
  kind: string;
  value_numeric: number | null;
  value_secondary: number | null;
  unit: string | null;
  taken_at: string;
  context_note: string | null;
  source: string;
}

export interface MedicationRecord {
  id: string;
  name: string;
  dose: string | null;
  scheduled_times: string[] | null;
  start_date: string | null;
  end_date: string | null;
  reason: string | null;
  source: string | null;
}

export interface PulseRecords {
  customerId: string;
  /** Echo of the resolved subject scope for the consumer's display logic. */
  scope: { memberId: string | null | undefined };
  bookings: BookingRecord[];
  prescriptions: PrescriptionRecord[];
  vitals: VitalRecord[];
  medications: MedicationRecord[];
  conditions: ConditionRecord[];
  allergies: AllergyRecord[];
  documents: DocumentRecord[];
  /** Categories skipped because a specific member was requested (account-level only). */
  accountLevelOmitted: RecordCategory[];
}

function logErr(scope: string, err: unknown): void {
  // Mirror pulseData.ts: log loudly, return empty, never throw.
  console.error(`[pulse/recordsFetch] ${scope} failed:`, err);
}

/** Apply the member subject filter to a query on a table that HAS member_id. */
function applyMemberFilter<T extends { eq: (c: string, v: string) => T; is: (c: string, v: null) => T }>(
  q: T,
  column: string,
  memberId: string | null | undefined,
): T {
  if (memberId === undefined) return q; // all subjects
  if (memberId === null) return q.is(column, null); // account holder only
  return q.eq(column, memberId); // one specific member
}

async function fetchConditions(
  customerId: string,
  memberId: string | null | undefined,
  limit: number,
): Promise<ConditionRecord[]> {
  try {
    let q = supabaseAdmin
      .from("conditions")
      .select("id, member_id, label, status, source, noted_at, notes, created_at, updated_at")
      .eq("customer_id", customerId);
    q = applyMemberFilter(q, "member_id", memberId);
    const { data, error } = await q
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      logErr("conditions", error);
      return [];
    }
    return (data ?? []) as ConditionRecord[];
  } catch (err) {
    logErr("conditions", err);
    return [];
  }
}

async function fetchAllergies(
  customerId: string,
  memberId: string | null | undefined,
  limit: number,
): Promise<AllergyRecord[]> {
  try {
    let q = supabaseAdmin
      .from("allergies")
      .select(
        "id, member_id, label, severity, reaction, status, source, noted_at, notes, created_at, updated_at",
      )
      .eq("customer_id", customerId);
    q = applyMemberFilter(q, "member_id", memberId);
    const { data, error } = await q
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      logErr("allergies", error);
      return [];
    }
    return (data ?? []) as AllergyRecord[];
  } catch (err) {
    logErr("allergies", err);
    return [];
  }
}

async function fetchDocuments(
  customerId: string,
  memberId: string | null | undefined,
  limit: number,
): Promise<DocumentRecord[]> {
  try {
    // Metadata only — file_path is intentionally NOT selected. Signed URLs are
    // minted on demand in Slice C, keyed by document id, with their own audit.
    let q = supabaseAdmin
      .from("pulse_documents")
      .select("id, member_id, doc_type, label, mime_type, file_size_bytes, source, uploaded_at")
      .eq("customer_id", customerId)
      .is("deleted_at", null);
    q = applyMemberFilter(q, "member_id", memberId);
    const { data, error } = await q
      .order("uploaded_at", { ascending: false })
      .limit(limit);
    if (error) {
      logErr("documents", error);
      return [];
    }
    return (data ?? []) as DocumentRecord[];
  } catch (err) {
    logErr("documents", err);
    return [];
  }
}

async function fetchBookings(
  customerId: string,
  memberId: string | null | undefined,
  limit: number,
): Promise<BookingRecord[]> {
  try {
    let q = supabaseAdmin
      .from("bookings")
      .select("id, member_id, service_category, status, scheduled_for, created_at")
      .eq("customer_id", customerId);
    q = applyMemberFilter(q, "member_id", memberId);
    const { data, error } = await q
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      logErr("bookings", error);
      return [];
    }
    return (data ?? []) as BookingRecord[];
  } catch (err) {
    logErr("bookings", err);
    return [];
  }
}

async function fetchPrescriptions(
  customerId: string,
  memberId: string | null | undefined,
  limit: number,
): Promise<PrescriptionRecord[]> {
  try {
    // Owned via the booking (prescriptions.booking_id → bookings). The member
    // filter is applied on the embedded booking's member_id. Two doctor FKs make
    // an embedded doctors(...) ambiguous, so names are resolved in one batch.
    let q = supabaseAdmin
      .from("prescriptions")
      .select("id, sent_at, patient_view_token, doctor_id, bookings!inner(customer_id, member_id)")
      .eq("bookings.customer_id", customerId)
      .eq("status", "sent");
    if (memberId === null) q = q.is("bookings.member_id", null);
    else if (memberId !== undefined) q = q.eq("bookings.member_id", memberId);
    const { data, error } = await q
      .order("sent_at", { ascending: false })
      .limit(limit);
    if (error) {
      logErr("prescriptions", error);
      return [];
    }
    const rows = data ?? [];
    if (rows.length === 0) return [];

    const doctorIds = Array.from(
      new Set(rows.map((r) => (r as { doctor_id?: string | null }).doctor_id).filter(Boolean)),
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
      const row = r as {
        id: string;
        sent_at: string | null;
        patient_view_token: string | null;
        doctor_id: string | null;
      };
      return {
        id: row.id,
        doctor_name: row.doctor_id ? (nameById.get(row.doctor_id) ?? null) : null,
        sent_at: row.sent_at ?? null,
        patient_view_token: row.patient_view_token ?? null,
      };
    });
  } catch (err) {
    logErr("prescriptions", err);
    return [];
  }
}

async function fetchVitals(customerId: string, limit: number): Promise<VitalRecord[]> {
  // Account-level (no member_id column). Latest reading per kind, like the home tile.
  try {
    const { data, error } = await supabaseAdmin
      .from("vital_readings")
      .select("id, kind, value_numeric, value_secondary, unit, taken_at, context_note, source")
      .eq("customer_id", customerId)
      .order("taken_at", { ascending: false })
      .limit(Math.max(limit, 60));
    if (error) {
      logErr("vitals", error);
      return [];
    }
    const seen = new Set<string>();
    const latest: VitalRecord[] = [];
    for (const r of (data ?? []) as VitalRecord[]) {
      if (seen.has(r.kind)) continue;
      seen.add(r.kind);
      latest.push(r);
      if (latest.length >= limit) break;
    }
    return latest;
  } catch (err) {
    logErr("vitals", err);
    return [];
  }
}

async function fetchMedications(customerId: string, limit: number): Promise<MedicationRecord[]> {
  // Account-level (no member_id column). Active medications: no end_date, or
  // end_date today-or-later.
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabaseAdmin
      .from("medications")
      .select("id, name, dose, scheduled_times, start_date, end_date, reason, source")
      .eq("customer_id", customerId)
      .or(`end_date.is.null,end_date.gte.${today}`)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      logErr("medications", error);
      return [];
    }
    return (data ?? []) as MedicationRecord[];
  } catch (err) {
    logErr("medications", err);
    return [];
  }
}

function memberScopeLabel(memberId: string | null | undefined): "all" | "account_holder" | "member" {
  if (memberId === undefined) return "all";
  if (memberId === null) return "account_holder";
  return "member";
}

/**
 * Read the resolved customer's own records, account-scoped by `customerId`,
 * with an optional member subject filter. Writes one phone-free, identity-aware
 * audit row (DPDP). Never throws on a per-category read failure.
 *
 * @param customerId  The verified account owner. From getCurrentCustomer()
 *                    (Pulse) or adapter-injected resolveIdentity() (Aarogya).
 *                    NEVER from tool input or a request body.
 */
export async function fetchPulseRecords(
  customerId: string,
  filter: PulseRecordsFilter,
  audit: PulseRecordsAudit,
): Promise<PulseRecords> {
  const memberId = filter.memberId;
  const limit = filter.limit ?? DEFAULT_LIMIT;
  const requested = filter.categories ?? ALL_RECORD_CATEGORIES;
  const want = (c: RecordCategory): boolean => requested.includes(c);
  const specificMember = typeof memberId === "string";

  // Account-level categories cannot be attributed to one member this slice.
  const accountLevelOmitted: RecordCategory[] = specificMember
    ? ACCOUNT_LEVEL_CATEGORIES.filter((c) => want(c))
    : [];
  const includeAccountLevel = !specificMember;

  const [bookings, prescriptions, vitals, medications, conditions, allergies, documents] =
    await Promise.all([
      want("bookings") ? fetchBookings(customerId, memberId, limit) : Promise.resolve([]),
      want("prescriptions") ? fetchPrescriptions(customerId, memberId, limit) : Promise.resolve([]),
      want("vitals") && includeAccountLevel ? fetchVitals(customerId, limit) : Promise.resolve([]),
      want("medications") && includeAccountLevel
        ? fetchMedications(customerId, limit)
        : Promise.resolve([]),
      want("conditions") ? fetchConditions(customerId, memberId, limit) : Promise.resolve([]),
      want("allergies") ? fetchAllergies(customerId, memberId, limit) : Promise.resolve([]),
      want("documents") ? fetchDocuments(customerId, memberId, limit) : Promise.resolve([]),
    ]);

  const records: PulseRecords = {
    customerId,
    scope: { memberId },
    bookings,
    prescriptions,
    vitals,
    medications,
    conditions,
    allergies,
    documents,
    accountLevelOmitted,
  };

  // DPDP: one audit row per access. Phone-free — counts only, never contents.
  await writeAudit({
    conversationId: audit.conversationId ?? null,
    eventType: AuditEvent.PULSE_RECORDS_FETCHED,
    identity: audit.identity,
    eventData: {
      accessor: audit.accessor,
      member_scope: memberScopeLabel(memberId),
      categories: requested,
      account_level_omitted: accountLevelOmitted,
      counts: {
        bookings: bookings.length,
        prescriptions: prescriptions.length,
        vitals: vitals.length,
        medications: medications.length,
        conditions: conditions.length,
        allergies: allergies.length,
        documents: documents.length,
      },
    },
  });

  return records;
}
