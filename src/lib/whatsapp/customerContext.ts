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
// CareHub: schema doesn't exist yet (no carehub_subscriptions table — M061
// lands in Slice 5). Until then, `carehub` is ALWAYS `null`. The loader is
// shaped to receive a real row when M061 ships — Slice 5 extends THIS
// function, not a new one.
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
  /** CareHub membership info. NULL until M061 lands in Slice 5. The
   *  shape will become { active: boolean; cycle: string | null;
   *  started_at: string | null; } at that point — Slice 5 widens this
   *  type AND populates it in the same PR. */
  carehub: null;
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
  const [customer, lastBooking, language] = await Promise.all([
    loadCustomer(identity),
    loadLastBooking(phone),
    loadStoredLanguage(conversationId),
  ]);

  return {
    identity,
    customer,
    last_booking: lastBooking,
    carehub: null,
    language,
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
