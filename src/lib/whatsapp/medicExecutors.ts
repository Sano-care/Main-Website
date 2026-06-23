// Aarogya Medic Help-Mode (Part 1) — tool executors (sidecar).
//
// Three medic-only tools. Identity is ADAPTER-INJECTED (never model input) and
// every executor re-gates on identity.role === 'medic' — defense-in-depth on top
// of the withheld tool schema (the orchestrator only advertises these to medics).
//
// Part 1 is reads + audit + the existing ops-alert rail only — NO migrations.
// escalate_to_doctor therefore does NOT write a typed escalations row: the
// escalations.escalation_type CHECK has no 'medic_to_doctor' value and adding one
// needs a migration (deferred to Part 2). It instead alerts ops via the existing
// ops-handoff sender (tagged [MEDIC→DOCTOR]) + writes the medic_escalation_to_doctor
// audit event — ops still gets the alert and connects the medic to the doctor.

import { supabaseAdmin } from "@/lib/supabase-server";
import { AuditEvent, writeAudit } from "@/lib/whatsapp/safety/audit";
import type { Identity } from "@/lib/whatsapp/identity";
import { log } from "@/lib/whatsapp/log";

type MedicIdentity = Extract<Identity, { role: "medic" }>;
type SupabaseLike = typeof supabaseAdmin;
type WriteAuditFn = typeof writeAudit;

/** The exact shape of adapter.sendOpsHandoff — injected so this module never
 *  imports the adapter (which would be a cycle) and stays unit-testable. */
export type OpsHandoffFn = (args: {
  conversationId: string;
  escalationId: string | null;
  patientName: string;
  patientAge: string;
  serviceDisplay: string;
  location: string;
  context: string;
  patientMobile: string;
}) => Promise<void>;

const NOT_MEDIC_REPLY = "That action isn't available here.";

function asMedic(identity: Identity): MedicIdentity | null {
  return identity.role === "medic" ? identity : null;
}

/**
 * escalate_to_doctor — alert ops to connect the medic to the on-call doctor.
 * Returns the medic-facing confirmation (or a refusal for a non-medic caller).
 */
export async function executeEscalateToDoctor(args: {
  identity: Identity;
  conversationId: string;
  medicPhone: string;
  input: { reason?: string };
  sendOpsHandoff: OpsHandoffFn;
  deps?: { writeAuditFn?: WriteAuditFn };
}): Promise<string> {
  const medic = asMedic(args.identity);
  if (!medic) {
    log.warn("escalate_to_doctor called by non-medic — refused");
    return NOT_MEDIC_REPLY;
  }
  const writeAuditFn = args.deps?.writeAuditFn ?? writeAudit;
  const reason = (args.input.reason ?? "").trim() || "(no reason given)";
  const medicName = medic.fullName || "Medic";

  // Existing ops-alert rail. escalationId=null — no typed escalations row in
  // Part 1 (see file header); ops gets the WhatsApp alert tagged [MEDIC→DOCTOR].
  await args.sendOpsHandoff({
    conversationId: args.conversationId,
    escalationId: null,
    patientName: `[MEDIC→DOCTOR] ${medicName}`,
    patientAge: "—",
    serviceDisplay: "Medic → Doctor escalation",
    location: "—",
    context: `[MEDIC→DOCTOR] ${medicName}: ${reason}`,
    patientMobile: args.medicPhone,
  });

  await writeAuditFn({
    conversationId: args.conversationId,
    eventType: AuditEvent.MEDIC_ESCALATION_TO_DOCTOR,
    eventData: { medic_id: medic.medicId, reason },
  });

  return "Done — I've alerted ops to connect you with the on-call doctor. They'll reach out shortly. If this is an emergency, call 112 now.";
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * fetch_booking_context — return a booking summary ONLY if it's assigned to the
 * calling medic. Refuses (same message) on not-found or wrong-owner so booking
 * existence isn't leaked.
 */
export async function executeFetchBookingContext(args: {
  identity: Identity;
  input: { booking_id?: string };
  deps?: { supabase?: SupabaseLike };
}): Promise<string> {
  const medic = asMedic(args.identity);
  if (!medic) {
    log.warn("fetch_booking_context called by non-medic — refused");
    return NOT_MEDIC_REPLY;
  }
  const supabase = args.deps?.supabase ?? supabaseAdmin;
  const ref = (args.input.booking_id ?? "").trim();
  if (!ref) return "Which booking? Send me the booking code.";

  const cols =
    "id, booking_code, medic_id, patient_name, service_category, specific_ailment, manual_address, status, scheduled_for";
  const query = supabase.from("bookings").select(cols);
  // booking_code is what the medic sees; only query by id when it's a real UUID
  // (querying id with a non-UUID raises a Postgres type error).
  const filtered = UUID_RE.test(ref)
    ? query.eq("id", ref)
    : query.eq("booking_code", ref);
  const { data, error } = await filtered.maybeSingle();

  if (error) {
    log.error("fetch_booking_context lookup failed", error.message);
    return "Couldn't look that up right now — try again in a moment.";
  }

  const booking = data as {
    id: string;
    booking_code: string | null;
    medic_id: string | null;
    patient_name: string | null;
    service_category: string | null;
    specific_ailment: string | null;
    manual_address: string | null;
    status: string | null;
    scheduled_for: string | null;
  } | null;

  // Ownership gate — not-found and not-yours both refuse identically.
  if (!booking || booking.medic_id !== medic.medicId) {
    return "That booking isn't assigned to you, so I can't share its details. Double-check the code, or ask ops.";
  }

  const lines = [
    `Booking ${booking.booking_code ?? booking.id}`,
    `Patient: ${booking.patient_name ?? "—"}`,
    `Service: ${booking.service_category ?? "—"}${booking.specific_ailment ? ` (${booking.specific_ailment})` : ""}`,
    `Status: ${booking.status ?? "—"}`,
    `Scheduled: ${booking.scheduled_for ?? "—"}`,
    `Address: ${booking.manual_address ?? "—"}`,
  ];
  return lines.join("\n");
}

/**
 * log_medic_query — append a medic_query audit row. Logging only; returns null
 * so the model's own KB answer remains the reply.
 */
export async function executeLogMedicQuery(args: {
  identity: Identity;
  conversationId: string;
  input: { question?: string };
  deps?: { writeAuditFn?: WriteAuditFn };
}): Promise<null> {
  const medic = asMedic(args.identity);
  if (!medic) {
    log.warn("log_medic_query called by non-medic — ignored");
    return null;
  }
  const writeAuditFn = args.deps?.writeAuditFn ?? writeAudit;
  await writeAuditFn({
    conversationId: args.conversationId,
    eventType: AuditEvent.MEDIC_QUERY,
    eventData: {
      medic_id: medic.medicId,
      question: (args.input.question ?? "").slice(0, 500),
    },
  });
  return null;
}
