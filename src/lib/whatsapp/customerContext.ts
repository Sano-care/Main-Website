// Slice 4a C2 — Tier-1 eager context loader.
//
// Runs ONCE per inbound turn, server-side, between resolveIdentity() and
// the Claude call. Materialises the 4 fields Aarogya needs to make the
// FIRST reply feel personal: customer name, last booking, carehub status,
// and the language hint stored on the conversation.
//
// PII discipline: Tier-1 deliberately does NOT surface full address,
// payment amounts, family-member details, or health records. Those are
// Tier-2 tool-call territory (get_booking_history, get_family_members in
// this slice; get_health_records / get_vitals in Slice 6).
//
// CareHub (Slice 5): `carehub` is populated from carehub_subscriptions (M061)
// when the customer has an ACTIVE membership; otherwise `null`. Only customers
// carry a customerId, so doctor/medic/ops/new turns are always `null` here.
//
// All DB reads use supabaseAdmin per the RLS-deny-all-tables rule
// (messages/conversations/audit_log are deny-all; bookings/customers are
// touched via supabaseAdmin for consistency with the rest of the agent
// pipeline).

import { supabaseAdmin } from "@/lib/supabase-server";
import { findBookingsByPhone } from "@/lib/agent/bookings";
import type { Identity } from "@/lib/whatsapp/identity";
import { log } from "@/lib/whatsapp/log";

/** Loader-input identity: existing Identity union plus the ops_founder
 *  variant the C4 router (and dev's identity.ts extension) adds. Declared
 *  here as the additive overlay so loadTier1Context compiles ahead of the
 *  union extension. Collapses to plain `Identity` once the variant lands. */
export type ContextIdentity = Identity | { role: "ops_founder"; phone: string };

export type DetectedLanguageHint = "english" | "hindi" | "hinglish" | null;

export interface Tier1Context {
  /** The resolved identity, threaded for downstream consumers (system
   *  prompt composer, ops router) so they don't re-resolve. */
  identity: ContextIdentity;
  /** Customer row when this phone is a known customer. Null for
   *  new visitor / doctor / medic / ops_founder. */
  customer: {
    id: string;
    full_name: string | null;
    created_at: string;
  } | null;
  /** Most recent booking of any status (PENDING through CANCELLED) for
   *  the inbound phone. Null when no bookings exist on this phone. */
  last_booking: {
    id: string;
    service_category: string | null;
    status: string;
    scheduled_for: string | null;
    created_at: string;
  } | null;
  /** CareHub membership info (Slice 5 / M061). Non-null only when the
   *  resolved customer has an ACTIVE carehub_subscriptions row. Used to
   *  surface member benefits + member-rate pricing in the system prompt. */
  carehub: {
    active: true;
    cycle: string;
    started_at: string;
    monthly_inr: number;
  } | null;
  /** Last-known language from conversations.language. The CURRENT-turn
   *  detection runs separately (C3) and overrides this for the reply
   *  language; stored value is for ops-side visibility ("which patients
   *  are Hindi-speaking?") and for relay drafts that need the recipient's
   *  preferred language. */
  language: DetectedLanguageHint;
}

/**
 * Load Tier-1 context for the just-received inbound turn.
 *
 * @param identity — resolved by resolveIdentity() upstream
 * @param phone — the inbound WhatsApp phone (the booking-history lookup
 *                runs on this; identity may not carry it for all variants)
 * @param conversationId — used to read conversations.language
 *
 * Returns a fully-populated Tier1Context. Errors are swallowed and
 * surfaced as `null` fields — Aarogya degrades gracefully (no greeting
 * personalization beats blowing up the turn).
 */
export async function loadTier1Context(
  identity: ContextIdentity,
  phone: string,
  conversationId: string,
): Promise<Tier1Context> {
  const [customer, lastBooking, carehub, language] = await Promise.all([
    loadCustomer(identity),
    loadLastBooking(phone),
    loadCarehub(identity),
    loadStoredLanguage(conversationId),
  ]);

  return {
    identity,
    customer,
    last_booking: lastBooking,
    carehub,
    language,
  };
}

/**
 * Load the customer's ACTIVE CareHub membership (Slice 5 / M061), or null.
 *
 * Only customers carry a customerId, so every other identity short-circuits
 * to null. `active = true` is the partial-index predicate, so this is a cheap
 * point lookup. Soft-fail: any error returns null (no membership beats a
 * blown-up turn — the patient just sees the non-member experience).
 */
async function loadCarehub(
  identity: ContextIdentity,
): Promise<Tier1Context["carehub"]> {
  if (identity.role !== "customer" || !("customerId" in identity) || !identity.customerId) {
    return null;
  }
  const { data, error } = await supabaseAdmin
    .from("carehub_subscriptions")
    .select("started_at, cycle, monthly_inr")
    .eq("customer_id", identity.customerId)
    .eq("active", true)
    .maybeSingle();
  if (error) {
    log.error("loadTier1Context.carehub read failed", error.message);
    return null;
  }
  if (!data) return null;
  return {
    active: true,
    cycle: data.cycle as string,
    started_at: data.started_at as string,
    monthly_inr: data.monthly_inr as number,
  };
}

async function loadCustomer(
  identity: ContextIdentity,
): Promise<Tier1Context["customer"]> {
  // Only registered/carehub customers carry a customerId.
  if (identity.role !== "customer" || !("customerId" in identity) || !identity.customerId) {
    return null;
  }
  const { data, error } = await supabaseAdmin
    .from("customers")
    .select("id, full_name, created_at")
    .eq("id", identity.customerId)
    .maybeSingle();
  if (error) {
    log.error("loadTier1Context.customer read failed", error.message);
    return null;
  }
  if (!data) return null;
  return {
    id: data.id as string,
    full_name: (data.full_name as string | null) ?? null,
    created_at: data.created_at as string,
  };
}

async function loadLastBooking(
  phone: string,
): Promise<Tier1Context["last_booking"]> {
  try {
    const { latest } = await findBookingsByPhone(phone);
    if (!latest) return null;
    // findBookingsByPhone doesn't include scheduled_for — fetch it
    // alongside the existing fields. Single row, indexed lookup.
    const { data, error } = await supabaseAdmin
      .from("bookings")
      .select("id, service_category, status, scheduled_for, created_at")
      .eq("id", latest.id)
      .maybeSingle();
    if (error || !data) {
      // Fallback to what findBookingsByPhone already returned —
      // scheduled_for becomes null but the rest is honest.
      return {
        id: latest.id,
        service_category: latest.service_category,
        status: latest.status,
        scheduled_for: null,
        created_at: latest.created_at,
      };
    }
    return {
      id: data.id as string,
      service_category: (data.service_category as string | null) ?? null,
      status: data.status as string,
      scheduled_for: (data.scheduled_for as string | null) ?? null,
      created_at: data.created_at as string,
    };
  } catch (err) {
    log.error("loadTier1Context.last_booking failed", err);
    return null;
  }
}

async function loadStoredLanguage(
  conversationId: string,
): Promise<DetectedLanguageHint> {
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select("language")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) {
    // Column may not exist on a stale schema — soft fail. The C3 write
    // path will surface that case if the UPDATE also errors.
    return null;
  }
  if (!data) return null;
  const raw = (data as { language?: string | null }).language;
  if (raw === "english" || raw === "hindi" || raw === "hinglish") return raw;
  return null;
}
