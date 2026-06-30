// Marketing Agent Slice 1 — shared types for the marketing_leads spine.
// Enum value sets mirror the CHECK constraints in
// supabase/migrations/20260630134915_marketing_leads_pipeline.sql — keep in sync.

export const MARKETING_SOURCES = [
  "meta_ctwa",
  "meta_lead_ad",
  "google_lead_form",
  "website_book",
  "website_callback",
  "justdial",
  "whatsapp_inbound",
  "b2b_discovery",
] as const;
export type MarketingSource = (typeof MARKETING_SOURCES)[number];

export const CONSENT_STATUSES = ["opted_in", "pending", "none", "opted_out"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const LEAD_STATES = [
  "new",
  "qualified",
  "nurturing",
  "hot",
  "booked",
  "lost",
  "b2b_prospect",
] as const;
export type LeadState = (typeof LEAD_STATES)[number];

export const SERVICE_INTENTS = [
  "gda",
  "medic_home",
  "teleconsult",
  "lab",
  "clinic_partner",
  "society",
] as const;
export type ServiceIntent = (typeof SERVICE_INTENTS)[number];

/** B2B intents + the b2b_discovery source route to the CRM track, never Aarogya. */
export const B2B_SERVICE_INTENTS: ReadonlySet<ServiceIntent> = new Set([
  "clinic_partner",
  "society",
]);

export interface LeadContact {
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
}

/** A single attribution touch (stored in last_touch jsonb). */
export interface TouchAttribution {
  source: MarketingSource;
  campaign: string | null;
  utm: UtmParams;
  at: string;
}

/** A marketing_leads row (the fields this slice reads/writes). */
export interface MarketingLead {
  id: string;
  created_at: string;
  updated_at: string;
  source: MarketingSource;
  campaign: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_content: string | null;
  utm_term: string | null;
  gclid: string | null;
  consent_status: ConsentStatus;
  score: number;
  state: LeadState;
  contact: LeadContact;
  last_touch: TouchAttribution | null;
  normalized_phone: string | null;
  email_lc: string | null;
  service_intent: ServiceIntent | null;
  linked_booking_id: string | null;
  linked_lead_id: string | null;
  lifetime_value: number;
  aarogya_nurture: boolean;
  assigned_to: string | null;
  routed_at: string | null;
  notes: string | null;
}

export interface UtmParams {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  gclid?: string | null;
}

/** Intake payload — one inbound touch from any source. */
export interface MarketingLeadInput {
  source: MarketingSource;
  contact: LeadContact;
  campaign?: string | null;
  utm?: UtmParams;
  service_intent?: ServiceIntent | null;
  consent_status?: ConsentStatus;
  /** Optional signal that this touch is urgent (drives the hot-lead route). */
  urgency_high?: boolean;
  notes?: string | null;
  linked_lead_id?: string | null;
}

/** Last-10-digit normalization for cross-source phone dedupe (matches the
 *  bookings/leads suffix-match convention). Returns null when no 10 digits. */
export function normalizePhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e.length > 0 ? e : null;
}
