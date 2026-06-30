// Map a hot marketing lead onto the existing aarogya_lead_alert ops path. We
// REUSE sendOpsAlert (no new alert path); the template's {{5}} free-text slot
// carries a lead summary that mirrors contextFormat.ts's single-line
// "{left} | {right}" convention. (The payment-based formatLeadAlertContext is
// booking-stage only — a pre-booking lead has no payment, so we format the lead
// context here in the same spirit.)

import type { OpsAlertArgs } from "@/lib/whatsapp/opsAlert";
import type { MarketingLead, ServiceIntent } from "./types";

const SERVICE_DISPLAY: Record<ServiceIntent, string> = {
  gda: "GDA / attendant",
  medic_home: "Medic at Home",
  teleconsult: "Teleconsultation",
  lab: "Lab Test at Home",
  clinic_partner: "Clinic partner",
  society: "Society / B2B",
};

/** The {{5}} Context string for a marketing hot-lead alert. */
export function formatMarketingLeadContext(lead: MarketingLead): string {
  const left = lead.notes?.trim() || lead.service_intent || "new lead";
  const campaign = [lead.source, lead.campaign].filter(Boolean).join("/");
  return `${left} | ${campaign || lead.source}, score ${lead.score}`;
}

/** Build OpsAlertArgs from a marketing lead (no conversation / escalation). */
export function marketingLeadToOpsAlert(lead: MarketingLead): OpsAlertArgs {
  const phone = lead.contact.phone ?? lead.contact.whatsapp ?? "";
  return {
    conversationId: null, // not a WhatsApp conversation
    escalationId: null,
    patientName: lead.contact.email?.split("@")[0] ?? "lead",
    patientAge: "—",
    serviceDisplay: lead.service_intent ? SERVICE_DISPLAY[lead.service_intent] : "Marketing lead",
    location: "—",
    context: formatMarketingLeadContext(lead),
    patientMobile: phone || "unknown",
  };
}
