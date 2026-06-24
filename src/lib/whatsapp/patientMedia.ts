// Patient photo & PDF interpretation — pure classification + identity-gate logic.
//
// HARD BOUNDARY (founder, non-negotiable): CHARACTERISE only — what KIND of doc.
// NEVER read/interpret clinical contents (no lab values, regimens, diagnoses,
// advice). The classifier prompt forbids it; visible_person_name/visible_age are
// extracted ONLY for the identity gate (matching the account owner), never used
// clinically. MoHFW Telemedicine 2020 / DPDP.

import { analyzeImage } from "@/lib/agent/vision";

export type DocCategory =
  | "prescription"
  | "lab_report"
  | "medication_photo"
  | "discharge_summary"
  | "other_medical"
  | "non_medical"
  | "unclear";

const MEDICAL_CATEGORIES: ReadonlySet<DocCategory> = new Set([
  "prescription",
  "lab_report",
  "medication_photo",
  "discharge_summary",
  "other_medical",
]);

export function isFileableMedical(category: DocCategory): boolean {
  return MEDICAL_CATEGORIES.has(category);
}

export interface MediaClassification {
  category: DocCategory;
  /** Person name printed on the doc — for the IDENTITY GATE only, not clinical. */
  visiblePersonName: string | null;
  /** Age printed on the doc — secondary identity signal only. */
  visibleAge: number | null;
}

export const CLASSIFY_PROMPT =
  "Characterise this document/image into EXACTLY one category. Do NOT read, " +
  "transcribe, or interpret any clinical content — no lab values, dosages, " +
  "diagnoses, medicine names, or regimens. Categories: " +
  '"prescription", "lab_report", "medication_photo" (a photo of a medicine ' +
  'strip/box/bottle), "discharge_summary", "other_medical", "non_medical" ' +
  '(not a medical document at all), "unclear" (too blurry/ambiguous to tell). ' +
  "Separately, ONLY for matching the account holder's identity (NOT for clinical " +
  "use), report the person NAME printed on the document and their AGE if printed. " +
  'Return JSON ONLY: {"type": <category>, "confidence": 0..1, "fields": ' +
  '{"visible_person_name": <string or null>, "visible_age": <number or null>}}.';

/** One vision pass → typed characterisation. Routes image vs PDF inside the
 *  vision client (document block for PDFs). Unknown/garbage → "unclear". */
export async function classifyPatientMedia(
  bytes: Uint8Array,
  mimeType: string,
  deps: { analyze?: typeof analyzeImage } = {},
): Promise<MediaClassification> {
  const analyze = deps.analyze ?? analyzeImage;
  const result = await analyze({ bytes, mimeType, taskPrompt: CLASSIFY_PROMPT });
  return normalizeClassification(result.type, result.fields);
}

export function normalizeClassification(
  rawType: string,
  fields: Record<string, unknown> | undefined,
): MediaClassification {
  const t = (rawType ?? "").toLowerCase().trim();
  const category: DocCategory = (
    [
      "prescription",
      "lab_report",
      "medication_photo",
      "discharge_summary",
      "other_medical",
      "non_medical",
      "unclear",
    ] as const
  ).includes(t as DocCategory)
    ? (t as DocCategory)
    : "unclear";
  const name = fields?.visible_person_name;
  const age = fields?.visible_age;
  return {
    category,
    visiblePersonName: typeof name === "string" && name.trim() ? name.trim() : null,
    visibleAge: typeof age === "number" && Number.isFinite(age) ? age : null,
  };
}

// ── Identity / anomaly gate (D2/D3) ──────────────────────────────────────────
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

/** Lenient name match: exact, or first-token containment ("Sushma" ≈
 *  "Sushma Sharma"). Names on docs are often partial/abbreviated. */
export function namesMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const fa = na.split(" ")[0];
  const fb = nb.split(" ")[0];
  // require the first token to match AND one full string to contain the other.
  return fa === fb && (na.includes(nb) || nb.includes(na) || na.split(" ")[0] === nb.split(" ")[0]);
}

export interface OwnerInfo {
  fullName: string | null;
}
export interface MemberInfo {
  id: string;
  name: string;
}

export type OwnershipDecision =
  | { anomaly: false; matched: "owner" | "member" | "unchecked"; memberId: string | null }
  | { anomaly: true; reason: "not_on_account" };

/**
 * Decide whether the doc's visible identity is consistent with the account.
 * - no visible name → can't check → not an anomaly (store as Self).
 * - matches owner → Self.
 * - matches a family member NAME → on-account (not an anomaly). NOTE: per D2,
 *   member ATTRIBUTION still comes from the patient's explicit words, not the
 *   doc — so memberId stays null here; the caller may set it from the caption.
 * - matches neither → anomaly (belongs to someone not on the account).
 */
export function assessOwnership(
  visibleName: string | null,
  owner: OwnerInfo,
  members: MemberInfo[],
): OwnershipDecision {
  if (!visibleName) return { anomaly: false, matched: "unchecked", memberId: null };
  if (namesMatch(visibleName, owner.fullName)) return { anomaly: false, matched: "owner", memberId: null };
  if (members.some((m) => namesMatch(visibleName, m.name))) {
    return { anomaly: false, matched: "member", memberId: null };
  }
  return { anomaly: true, reason: "not_on_account" };
}

/** Explicit member attribution from the patient's own words (D2 — never guess
 *  from the document). Returns the member id if the text names one, else null. */
export function memberFromText(text: string | null, members: MemberInfo[]): string | null {
  if (!text) return null;
  const nt = norm(text);
  for (const m of members) {
    const fn = norm(m.name).split(" ")[0];
    if (fn && nt.includes(fn)) return m.id;
    // relation words could be added here, but stay conservative: name match only.
  }
  return null;
}

// ── Acks (characterise-only; never interpret contents) ───────────────────────
const TYPE_LABEL: Record<DocCategory, string> = {
  prescription: "prescription",
  lab_report: "lab report",
  medication_photo: "medicine",
  discharge_summary: "discharge summary",
  other_medical: "medical document",
  non_medical: "document",
  unclear: "document",
};

export function docTypeLabel(category: DocCategory): string {
  return TYPE_LABEL[category];
}

/** "Got it — looks like a lab report 📄. Save it to your Sanocare records? Reply YES." */
export function composeSaveAsk(category: DocCategory): string {
  return `Got it — looks like a ${TYPE_LABEL[category]} 📄. I can't read medical details over chat, but I can keep it safe for you. Save it to your Sanocare records? Reply YES to save, or NO to skip.`;
}

export const NON_MEDICAL_REPLY =
  "That doesn't look like a medical document — if you have a prescription, lab report, or a clear photo of your medicine, send it over and I'll keep it on file.";
export const UNCLEAR_REPLY =
  "I couldn't quite make that out — could you resend a clearer photo, or a PDF if you have one?";
export const ANOMALY_REPLY =
  "This looks like it belongs to someone who isn't on your account, so I can't save it here. If it's for you or a family member on your account, let me know whose it is.";
export const NON_PDF_DOC_REPLY =
  "I can only read PDFs or clear photos — please send the prescription or report as a PDF or a photo.";
