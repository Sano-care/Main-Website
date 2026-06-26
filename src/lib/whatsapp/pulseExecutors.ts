// Pulse Records — Aarogya tool executors (Slice C).
//
// Sidecar to keep adapter.ts small (mirrors slice4aExecutors.ts). The adapter's
// tool-dispatch switch calls these for fetch_pulse_records / upload_to_pulse_vault
// / explain_record. Each:
//   * gates on the ADAPTER-INJECTED identity (role==='customer' && customerId) —
//     identity is NEVER taken from the tool's input; a non-customer is refused.
//   * delegates to the Slice A/C libs (which carry the ownership boundary).
//   * is auditable (DPDP): fetch + upload self-audit inside their libs;
//     explain audits here.
// Each returns the patient-facing reply string the adapter sends back.

import {
  fetchPulseRecords,
  type PulseRecords,
  type PulseRecordsFilter,
  type RecordCategory,
} from "@/lib/pulse/recordsFetch";
import { uploadToPulseVault, type VaultMediaRef } from "@/lib/pulse/documentVault";
import { explainRecord } from "@/lib/pulse/recordsExplain";
import {
  AuditEvent,
  writeAudit,
  type AuditIdentity,
} from "@/lib/whatsapp/safety/audit";
import {
  identityForAudit,
  resolveCustomerIdByPhone,
  type Identity,
} from "@/lib/whatsapp/identity";
import { normaliseScheduledTimes } from "@/app/api/pulse/_lib/medications";
import { istTodayYMD } from "@/app/api/pulse/_lib/ist";
import {
  createMedication,
  findActiveMedicationByName,
  updateMedicationSchedule,
  frequencyLabelForCount,
} from "@/app/api/pulse/_lib/createMedication";

const NOT_A_CUSTOMER =
  "I can only pull up records once you have a Sanocare account — book a visit and I'll start keeping your records here for you.";

const KNOWN_CATEGORIES: RecordCategory[] = [
  "bookings",
  "prescriptions",
  "vitals",
  "medications",
  "conditions",
  "allergies",
  "documents",
];

function customerIdOf(identity: Identity): string | null {
  if (identity.role !== "customer" || !("customerId" in identity) || !identity.customerId) {
    return null;
  }
  return identity.customerId;
}

// ---------------------------------------------------------------------------
// fetch_pulse_records
// ---------------------------------------------------------------------------

export async function executeFetchPulseRecords(args: {
  identity: Identity;
  conversationId: string;
  input: { categories?: string[]; member_id?: string };
}): Promise<string> {
  const customerId = customerIdOf(args.identity);
  if (!customerId) return NOT_A_CUSTOMER;

  const categories = (args.input.categories ?? []).filter((c): c is RecordCategory =>
    (KNOWN_CATEGORIES as string[]).includes(c),
  );
  const filter: PulseRecordsFilter = {
    memberId: args.input.member_id ?? null,
    categories: categories.length > 0 ? categories : undefined,
  };

  // fetchPulseRecords scopes by customerId and writes the PULSE_RECORDS_FETCHED
  // audit row itself (Slice A) — we do not re-audit here.
  const records = await fetchPulseRecords(customerId, filter, {
    identity: identityForAudit(args.identity),
    accessor: "aarogya",
    conversationId: args.conversationId,
  });

  return summarizeRecords(records);
}

function summarizeRecords(r: PulseRecords): string {
  const lines: string[] = [];
  const push = (label: string, n: number, sample?: string) => {
    if (n > 0) lines.push(`• ${label}: ${n}${sample ? ` (${sample})` : ""}`);
  };

  push(
    "Bookings",
    r.bookings.length,
    r.bookings[0] ? `latest ${r.bookings[0].service_category ?? "service"}` : undefined,
  );
  push(
    "Prescriptions",
    r.prescriptions.length,
    r.prescriptions[0]?.doctor_name ? `latest from Dr ${r.prescriptions[0].doctor_name}` : undefined,
  );
  push(
    "Vitals",
    r.vitals.length,
    r.vitals[0] ? `latest ${r.vitals[0].kind.replace(/_/g, " ")}` : undefined,
  );
  push(
    "Medications",
    r.medications.length,
    r.medications[0]?.name ?? undefined,
  );
  push("Conditions", r.conditions.length, r.conditions[0]?.label ?? undefined);
  push("Allergies", r.allergies.length, r.allergies[0]?.label ?? undefined);
  push("Documents", r.documents.length);

  if (lines.length === 0) {
    return "I don't see any records on your account yet. Once you have a visit, consult, or report, it'll show up here.";
  }

  let out = `Here's what's on your records:\n${lines.join("\n")}`;
  if (r.accountLevelOmitted.length > 0) {
    out +=
      "\n\n(Vitals and medications are kept for your whole account — ask me without picking a family member to see them.)";
  }
  out += "\n\nWant me to open up any of these, or explain a term on one of them?";
  return out;
}

// ---------------------------------------------------------------------------
// upload_to_pulse_vault
// ---------------------------------------------------------------------------

export async function executeUploadToPulseVault(args: {
  identity: Identity;
  conversationId: string;
  /** Adapter-extracted from the inbound message (mediaRefFromRaw). */
  media: VaultMediaRef | null;
  input: { doc_type?: string; label?: string; member_id?: string };
}): Promise<string> {
  const customerId = customerIdOf(args.identity);
  if (!customerId) return NOT_A_CUSTOMER;

  // uploadToPulseVault self-audits (PULSE_VAULT_UPLOADED) and carries the
  // upload-rollback. customer_id comes from identity inside the lib.
  const result = await uploadToPulseVault(
    {
      identity: args.identity,
      media: args.media,
      docType: args.input.doc_type,
      label: args.input.label ?? null,
      memberId: args.input.member_id ?? null,
      conversationId: args.conversationId,
    },
    {},
  );
  return result.message;
}

// ---------------------------------------------------------------------------
// explain_record
// ---------------------------------------------------------------------------

export async function executeExplainRecord(args: {
  identity: Identity;
  conversationId: string;
  input: { record_id?: string };
  deps?: { writeAuditFn?: typeof writeAudit };
}): Promise<string> {
  const customerId = customerIdOf(args.identity);
  if (!customerId) return NOT_A_CUSTOMER;

  const recordId = args.input.record_id ?? "";
  // explainRecord enforces the ownership boundary (customer_id) — a cross-
  // account id matches nothing and is refused, never explained.
  const result = await explainRecord(customerId, recordId);

  const writeAuditFn = args.deps?.writeAuditFn ?? writeAudit;
  const auditIdentity: AuditIdentity = identityForAudit(args.identity);
  await writeAuditFn({
    conversationId: args.conversationId,
    eventType: AuditEvent.PULSE_RECORD_EXPLAINED,
    identity: auditIdentity,
    eventData: {
      // record id is the patient's own; phone-free, no record contents.
      record_id: recordId || null,
      found: result.found,
      record_type: result.recordType,
    },
  });

  return result.message;
}

// ---------------------------------------------------------------------------
// log_medication — set a medication reminder by chat
// ---------------------------------------------------------------------------

const MED_NOT_A_CUSTOMER =
  "Once you've got a Sanocare account I can set medicine reminders for you — book a visit and I'll start looking after them here.";

/** Flag OFF → don't promise a reminder #107 won't send yet. Point to Pulse —
 *  never to an external app. */
function medPulsePointer(name: string): string {
  return `You can add ${name} in the Sanocare Pulse app and we'll keep track of it for you.`;
}

/** "20:40" → "8:40 PM" (IST clock, no tz math — it's already a wall-clock time). */
function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Join times for the confirmation: "8:40 PM", "8:40 PM and 11:00 PM", … */
function joinTimes(times: string[]): string {
  const human = times.map(to12h);
  if (human.length <= 1) return human[0] ?? "";
  if (human.length === 2) return `${human[0]} and ${human[1]}`;
  return `${human.slice(0, -1).join(", ")}, and ${human[human.length - 1]}`;
}

export async function executeLogMedication(args: {
  identity: Identity;
  conversationId: string;
  input: { name?: string; scheduled_times?: string[]; dose?: string; reason?: string };
  deps?: {
    enabled?: boolean;
    now?: Date;
    createFn?: typeof createMedication;
    findActiveFn?: typeof findActiveMedicationByName;
    updateFn?: typeof updateMedicationSchedule;
    writeAuditFn?: typeof writeAudit;
    resolveCustomerIdFn?: typeof resolveCustomerIdByPhone;
  };
}): Promise<string> {
  let customerId = customerIdOf(args.identity);
  // ops_founder is the founder's OWN phone, which is also a customer row — so
  // the founder can set their own reminders. Resolve their customer_id by phone
  // (identity-scoped: only ever the inbound phone's own record).
  if (!customerId && args.identity.role === "ops_founder") {
    const resolveCustomerIdFn = args.deps?.resolveCustomerIdFn ?? resolveCustomerIdByPhone;
    customerId = await resolveCustomerIdFn(args.identity.phone);
  }
  if (!customerId) return MED_NOT_A_CUSTOMER;

  const name = (args.input.name ?? "").trim();
  const times = normaliseScheduledTimes(args.input.scheduled_times);
  if (!name) return "Which medicine should I set the reminder for?";
  if (times.length === 0) {
    return `What time should I remind you to take ${name}? (e.g. 8:40 PM)`;
  }

  // Honest gating — only promise a reminder when the #107 cron is live to send
  // it; otherwise point to Pulse (never an external app).
  const enabled =
    args.deps?.enabled ?? process.env.WHATSAPP_MEDICATION_REMINDER_ENABLED === "true";
  if (!enabled) return medPulsePointer(name);

  const dose = (args.input.dose ?? "").trim() || "as directed"; // D1
  const reason = (args.input.reason ?? "").trim() || null;
  const timesPerDay = times.length;
  const frequencyLabel = frequencyLabelForCount(timesPerDay);
  const todayYmd = istTodayYMD(args.deps?.now);

  const writeAuditFn = args.deps?.writeAuditFn ?? writeAudit;
  const createFn = args.deps?.createFn ?? createMedication;
  const findActiveFn = args.deps?.findActiveFn ?? findActiveMedicationByName;
  const updateFn = args.deps?.updateFn ?? updateMedicationSchedule;
  const auditIdentity: AuditIdentity = identityForAudit(args.identity);

  // Dedup on (customer, name) — update the existing reminder rather than
  // stacking a duplicate medication row.
  const existing = await findActiveFn(customerId, name, todayYmd);
  if (existing) {
    const { ok } = await updateFn(existing.id, {
      scheduledTimes: times,
      timesPerDay,
      frequencyLabel,
      dose,
    });
    if (!ok) return "I couldn't update that just now — could you try again in a moment?";
    await writeAuditFn({
      conversationId: args.conversationId,
      eventType: AuditEvent.MEDICATION_LOGGED,
      identity: auditIdentity,
      eventData: { medication_id: existing.id, times_per_day: timesPerDay, updated: true },
    });
    return `Updated — I'll remind you to take ${name} at ${joinTimes(times)} every day.`;
  }

  const result = await createFn({
    customerId,
    name,
    dose,
    frequencyLabel,
    timesPerDay,
    scheduledTimes: times,
    startDate: todayYmd,
    endDate: null,
    reason,
    source: "aarogya_whatsapp",
  });
  if (result.error || !result.medication) {
    return "I couldn't save that just now — could you try again in a moment?";
  }

  await writeAuditFn({
    conversationId: args.conversationId,
    eventType: AuditEvent.MEDICATION_LOGGED,
    identity: auditIdentity,
    eventData: {
      medication_id: (result.medication.id as string) ?? null,
      times_per_day: timesPerDay,
      updated: false,
    },
  });
  return `Done — I'll remind you to take ${name} at ${joinTimes(times)} every day.`;
}
