// JustDial lead-push mapping helpers. Pure + unit-tested; the route wires these
// to upsertMarketingLead (Slice 1) + sendOpsAlert (no fork).

import type { OpsAlertArgs } from "@/lib/whatsapp/opsAlert";
import type { ServiceIntent } from "./types";

/** Map JD's free-text `category` to a marketing service_intent. Order matters
 *  (nursing before the generic fallback). Unknown → medic_home. */
export function mapJdCategory(category: string | null | undefined): ServiceIntent {
  const c = (category ?? "").toLowerCase();
  if (c.includes("nursing")) return "medic_home";
  if (c.includes("attendant") || c.includes("caretaker")) return "gda";
  if (c.includes("lab") || c.includes("diagnostic")) return "lab";
  if (c.includes("doctor")) return "teleconsult";
  return "medic_home";
}

export interface JdLeadFields {
  leadid: string;
  prefix?: string | null;
  name?: string | null;
  category?: string | null;
  area?: string | null;
  city?: string | null;
  pincode?: string | null;
  phone?: string | null; // normalized (last 10) or raw for the alert
}

/** notes = "JD#<leadid> | <category> | <area>, <city> <pincode>". */
export function buildJdNotes(f: JdLeadFields): string {
  const cityPin = [f.city, f.pincode].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
  const loc = [(f.area ?? "").trim(), cityPin].filter(Boolean).join(", ");
  return `JD#${f.leadid} | ${(f.category ?? "").trim() || "—"} | ${loc || "—"}`;
}

/** Map a JD lead onto the existing aarogya_lead_alert ops path (conversation-less). */
export function buildJdOpsAlert(f: JdLeadFields): OpsAlertArgs {
  const name = `${(f.prefix ?? "").trim()} ${(f.name ?? "").trim()}`.trim();
  const cityPin = [f.city, f.pincode].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
  const location = [(f.area ?? "").trim(), cityPin].filter(Boolean).join(", ");
  const category = (f.category ?? "").trim();
  return {
    conversationId: null, // not a WhatsApp conversation
    escalationId: null,
    patientName: name || "JustDial lead",
    patientAge: "—",
    serviceDisplay: category || "JustDial lead",
    location: location || "—",
    context: `New JustDial lead — ${category || "enquiry"}; call the number`,
    patientMobile: (f.phone ?? "").trim() || "unknown",
  };
}
