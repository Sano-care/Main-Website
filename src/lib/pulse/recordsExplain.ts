import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";

// ---------------------------------------------------------------------------
// Pulse Records — Aarogya record explainer (Slice C).
//
// explainRecord(customerId, recordId) turns one of the patient's OWN records
// into a plain-language, MoHFW-safe explanation.
//
// OWNERSHIP BOUNDARY (IDOR guard): every lookup is filtered by
// `customer_id = customerId` (prescriptions via their booking). A record id
// that belongs to another account matches nothing and falls through to a
// polite "I can only look at your own records" — it is NEVER explained.
//
// MoHFW Telemedicine 2020 — HARD: read / explain / surface only. NEVER
// diagnose, prescribe, dose, titrate, or say whether a value is good/bad/
// normal/dangerous. Every explanation that touches a clinical meaning ends at
// the same decision-point redirect: a teleconsult with a Sanocare MBBS doctor.
// ---------------------------------------------------------------------------

export type ExplainRecordType =
  | "vital"
  | "medication"
  | "condition"
  | "allergy"
  | "document"
  | "booking"
  | "prescription";

export interface ExplainResult {
  found: boolean;
  recordType: ExplainRecordType | null;
  message: string;
}

export interface ExplainRecordDeps {
  supabase?: typeof supabaseAdmin;
}

// The single decision-point redirect, reused everywhere a "what does it mean /
// what should I do / is it normal" question could arise.
const TELECONSULT =
  "For what this means for you or any next step, let me set up a teleconsult with our MBBS doctor — they can go through it with you.";

const NOT_YOURS =
  "I can only look at records on your own Sanocare account. I couldn't find that one under your account — could you pick it from your records again?";

const ASK_WHICH =
  "Which record would you like me to explain? Tell me and I'll pull it up from your account.";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Plain, threshold-free description of what a vital measures (NOT a verdict). */
const VITAL_GLOSS: Record<string, { label: string; gloss: string }> = {
  bp: { label: "blood pressure", gloss: "the pressure of blood against your artery walls, written as systolic/diastolic" },
  sugar_fasting: { label: "fasting blood sugar", gloss: "the glucose level in your blood after not eating for a while" },
  sugar_postprandial: { label: "post-meal blood sugar", gloss: "the glucose level in your blood a couple of hours after eating" },
  sugar_random: { label: "random blood sugar", gloss: "the glucose level in your blood at any time of day" },
  weight_kg: { label: "weight", gloss: "your body weight in kilograms" },
  temperature_c: { label: "temperature", gloss: "your body temperature in degrees Celsius" },
  spo2_pct: { label: "oxygen saturation (SpO₂)", gloss: "how much oxygen your blood is carrying, as a percentage" },
  pulse_bpm: { label: "pulse", gloss: "your heart rate in beats per minute" },
};

function istDate(iso: string | null): string {
  if (!iso) return "your records";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "your records";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

export async function explainRecord(
  customerId: string,
  recordId: string,
  deps: ExplainRecordDeps = {},
): Promise<ExplainResult> {
  const supabase = deps.supabase ?? supabaseAdmin;
  if (!recordId || !UUID_RE.test(recordId)) {
    return { found: false, recordType: null, message: ASK_WHICH };
  }

  // Each branch filters by customer_id — the ownership boundary. Order is by
  // how likely a patient is to ask "what does this mean".

  // 1) Vitals
  {
    const { data } = await supabase
      .from("vital_readings")
      .select("id, kind, value_numeric, value_secondary, unit, taken_at")
      .eq("id", recordId)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (data) return { found: true, recordType: "vital", message: explainVital(data) };
  }

  // 2) Documents (vault)
  {
    const { data } = await supabase
      .from("pulse_documents")
      .select("id, doc_type, label, uploaded_at, deleted_at")
      .eq("id", recordId)
      .eq("customer_id", customerId)
      .is("deleted_at", null)
      .maybeSingle();
    if (data) return { found: true, recordType: "document", message: explainDocument(data) };
  }

  // 3) Conditions
  {
    const { data } = await supabase
      .from("conditions")
      .select("id, label, status")
      .eq("id", recordId)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (data) return { found: true, recordType: "condition", message: explainCondition(data) };
  }

  // 4) Allergies
  {
    const { data } = await supabase
      .from("allergies")
      .select("id, label, severity, reaction")
      .eq("id", recordId)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (data) return { found: true, recordType: "allergy", message: explainAllergy(data) };
  }

  // 5) Medications
  {
    const { data } = await supabase
      .from("medications")
      .select("id, name, dose")
      .eq("id", recordId)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (data) return { found: true, recordType: "medication", message: explainMedication(data) };
  }

  // 6) Bookings
  {
    const { data } = await supabase
      .from("bookings")
      .select("id, service_category, status, created_at")
      .eq("id", recordId)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (data) return { found: true, recordType: "booking", message: explainBooking(data) };
  }

  // 7) Prescriptions — owned via the booking. Verify the booking's customer_id.
  {
    const { data } = await supabase
      .from("prescriptions")
      .select("id, sent_at, bookings!inner(customer_id)")
      .eq("id", recordId)
      .eq("bookings.customer_id", customerId)
      .maybeSingle();
    if (data) return { found: true, recordType: "prescription", message: explainPrescription(data) };
  }

  // Nothing matched under this customer — IDOR-safe refusal.
  return { found: false, recordType: null, message: NOT_YOURS };
}

// ---------------------------------------------------------------------------
// Per-type explainers — factual + glossary, then the teleconsult redirect.
// None of these ever judge a value or suggest a treatment.
// ---------------------------------------------------------------------------

function explainVital(r: {
  kind: string;
  value_numeric: number | null;
  value_secondary: number | null;
  unit: string | null;
  taken_at: string;
}): string {
  const meta = VITAL_GLOSS[r.kind];
  const label = meta?.label ?? r.kind.replace(/_/g, " ");
  const value =
    r.kind === "bp"
      ? `${r.value_numeric ?? "—"}/${r.value_secondary ?? "—"}`
      : `${r.value_numeric ?? "—"}`;
  const unit = r.unit ? ` ${r.unit}` : "";
  const glossLine = meta ? ` ${cap(label)} is ${meta.gloss}.` : "";
  return `Your ${label} on record from ${istDate(r.taken_at)} was ${value}${unit}.${glossLine} That's the reading we have — I can't tell you whether it's normal or what to do about it. ${TELECONSULT}`;
}

function explainDocument(r: { doc_type: string; label: string | null; uploaded_at: string }): string {
  const what = r.label?.trim() || DOC_LABEL[r.doc_type] || "document";
  return `That's ${aOrAn(what)} ${what} saved to your records on ${istDate(r.uploaded_at)}. I keep it safe but I can't read the values inside the file or tell you what they mean. ${TELECONSULT}`;
}

function explainCondition(r: { label: string; status: string }): string {
  return `Your records list ${r.label} (${r.status.toLowerCase()}). I can note it's on file, but I can't advise on managing it — that's a doctor's call. ${TELECONSULT}`;
}

function explainAllergy(r: { label: string; severity: string; reaction: string | null }): string {
  const sev = r.severity && r.severity !== "unknown" ? `, recorded as ${r.severity.toLowerCase()}` : "";
  const reaction = r.reaction ? ` It notes: ${r.reaction}.` : "";
  return `Your records note an allergy to ${r.label}${sev}.${reaction} Keep avoiding it and mention it to anyone treating you. ${TELECONSULT}`;
}

function explainMedication(r: { name: string; dose: string | null }): string {
  const dose = r.dose ? ` (${r.dose})` : "";
  return `On your records: ${r.name}${dose}. I can confirm what's listed, but I can't advise on it, change a dose, or tell you when to take it — only your doctor can. ${TELECONSULT}`;
}

function explainBooking(r: { service_category: string | null; status: string; created_at: string }): string {
  const service = r.service_category ? r.service_category.replace(/-/g, " ") : "service";
  return `That's your ${service} booking from ${istDate(r.created_at)}, currently ${r.status.toLowerCase()}. Want me to help with the booking itself — status, or a new one?`;
}

function explainPrescription(r: { sent_at: string | null }): string {
  return `That's a prescription on your account from ${istDate(r.sent_at)}. I can't change or advise on the medicines on it — your doctor handles that. ${TELECONSULT}`;
}

const DOC_LABEL: Record<string, string> = {
  lab_report: "lab report",
  prescription: "prescription",
  imaging: "scan",
  discharge_summary: "discharge summary",
  other: "document",
};

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function aOrAn(word: string): string {
  return /^[aeiou]/i.test(word.trim()) ? "an" : "a";
}
