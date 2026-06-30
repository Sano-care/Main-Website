// Multi-source lead intake. One upsert that dedupes a lead across sources by
// normalized phone (else email) and merges attribution: the row's top-level
// source/campaign/utm stay FIRST touch (immutable); each new touch is recorded
// in last_touch; consent only ratchets up (never silently downgrades except an
// explicit opt-out). Soft-fail: never throws into the caller (a marketing intake
// hiccup must not break a booking/website flow).

import { supabaseAdmin } from "@/lib/supabase-server";
import { log } from "@/lib/whatsapp/log";
import {
  normalizeEmail,
  normalizePhone,
  type ConsentStatus,
  type LeadContact,
  type MarketingLead,
  type MarketingLeadInput,
  type TouchAttribution,
} from "./types";

type SupabaseLike = typeof supabaseAdmin;

const LEAD_COLS =
  "id, created_at, updated_at, source, campaign, utm_source, utm_medium, utm_content, utm_term, gclid, consent_status, score, state, contact, last_touch, normalized_phone, email_lc, service_intent, linked_booking_id, linked_lead_id, lifetime_value, aarogya_nurture, assigned_to, routed_at, notes";

const CONSENT_RANK: Record<ConsentStatus, number> = {
  none: 0,
  pending: 1,
  opted_in: 2,
  opted_out: 3,
};

/** Consent ratchet: an explicit opt-out is sticky (a later form touch can't
 *  silently re-opt-in); otherwise take the stronger of the two. */
export function mergeConsent(existing: ConsentStatus, incoming: ConsentStatus): ConsentStatus {
  if (existing === "opted_out" || incoming === "opted_out") return "opted_out";
  return CONSENT_RANK[incoming] > CONSENT_RANK[existing] ? incoming : existing;
}

function definedOnly(contact: LeadContact): LeadContact {
  const out: LeadContact = {};
  if (contact.phone !== undefined) out.phone = contact.phone;
  if (contact.whatsapp !== undefined) out.whatsapp = contact.whatsapp;
  if (contact.email !== undefined) out.email = contact.email;
  return out;
}

export interface UpsertResult {
  lead: MarketingLead | null;
  created: boolean;
  error: string | null;
}

export interface IntakeDeps {
  supabase?: SupabaseLike;
  now?: string;
}

export async function upsertMarketingLead(
  input: MarketingLeadInput,
  deps: IntakeDeps = {},
): Promise<UpsertResult> {
  const supabase = deps.supabase ?? supabaseAdmin;
  const nowIso = deps.now ?? new Date().toISOString();

  try {
    const normalized_phone = normalizePhone(input.contact.phone ?? input.contact.whatsapp);
    const email_lc = normalizeEmail(input.contact.email);
    const utm = input.utm ?? {};
    const incomingTouch: TouchAttribution = {
      source: input.source,
      campaign: input.campaign ?? null,
      utm,
      at: nowIso,
    };

    // Dedupe: prefer phone, fall back to email.
    let existing: MarketingLead | null = null;
    if (normalized_phone) {
      const { data } = await supabase
        .from("marketing_leads")
        .select(LEAD_COLS)
        .eq("normalized_phone", normalized_phone)
        .maybeSingle();
      existing = (data as MarketingLead | null) ?? null;
    }
    if (!existing && email_lc) {
      const { data } = await supabase
        .from("marketing_leads")
        .select(LEAD_COLS)
        .eq("email_lc", email_lc)
        .maybeSingle();
      existing = (data as MarketingLead | null) ?? null;
    }

    if (existing) {
      // Merge — first-touch attribution is immutable; fill only previously-null
      // first-touch fields, record the new last_touch, ratchet consent.
      const patch = {
        last_touch: incomingTouch,
        contact: { ...existing.contact, ...definedOnly(input.contact) },
        email_lc: existing.email_lc ?? email_lc,
        normalized_phone: existing.normalized_phone ?? normalized_phone,
        consent_status: mergeConsent(existing.consent_status, input.consent_status ?? "none"),
        service_intent: existing.service_intent ?? input.service_intent ?? null,
        campaign: existing.campaign ?? input.campaign ?? null,
        utm_source: existing.utm_source ?? utm.utm_source ?? null,
        utm_medium: existing.utm_medium ?? utm.utm_medium ?? null,
        utm_content: existing.utm_content ?? utm.utm_content ?? null,
        utm_term: existing.utm_term ?? utm.utm_term ?? null,
        gclid: existing.gclid ?? utm.gclid ?? null,
        notes: input.notes ?? existing.notes,
      };
      const { data, error } = await supabase
        .from("marketing_leads")
        .update(patch)
        .eq("id", existing.id)
        .select(LEAD_COLS)
        .single();
      if (error) {
        log.error("upsertMarketingLead update failed", error.message);
        return { lead: existing, created: false, error: error.message };
      }
      return { lead: data as MarketingLead, created: false, error: null };
    }

    // First touch → insert.
    const row = {
      source: input.source,
      campaign: input.campaign ?? null,
      utm_source: utm.utm_source ?? null,
      utm_medium: utm.utm_medium ?? null,
      utm_content: utm.utm_content ?? null,
      utm_term: utm.utm_term ?? null,
      gclid: utm.gclid ?? null,
      consent_status: input.consent_status ?? "none",
      contact: definedOnly(input.contact),
      last_touch: incomingTouch,
      normalized_phone,
      email_lc,
      service_intent: input.service_intent ?? null,
      linked_lead_id: input.linked_lead_id ?? null,
      notes: input.notes ?? null,
    };
    const { data, error } = await supabase
      .from("marketing_leads")
      .insert(row)
      .select(LEAD_COLS)
      .single();

    if (error) {
      // Concurrent first-touch on the same phone — re-read the winner.
      if ((error as { code?: string }).code === "23505" && normalized_phone) {
        const { data: raced } = await supabase
          .from("marketing_leads")
          .select(LEAD_COLS)
          .eq("normalized_phone", normalized_phone)
          .maybeSingle();
        return {
          lead: (raced as MarketingLead | null) ?? null,
          created: false,
          error: raced ? null : error.message,
        };
      }
      log.error("upsertMarketingLead insert failed", error.message);
      return { lead: null, created: false, error: error.message };
    }
    return { lead: data as MarketingLead, created: true, error: null };
  } catch (e) {
    log.error("upsertMarketingLead threw", e instanceof Error ? e.message : String(e));
    return { lead: null, created: false, error: "exception" };
  }
}
