import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";

import { resolveWaClickToken } from "@/lib/wa/clickToken";

// Click-attribution stamping for the WhatsApp funnel.
//
//   inbound message  →  [ref: SC-XXXXXX]  →  wa_click_tokens  →  conversations.gclid
//   booking created  →  conversations.gclid (by phone, ≤90d)  →  bookings.gclid
//
// Everything here is best-effort: attribution must never block a WhatsApp reply
// or a booking/payment response. Failures log and return quietly.

/** Google Ads click-attribution window we honour end to end. */
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Stamp the click ids onto a conversation from a pre-extracted `[ref: …]`
 * token (parsed + stripped at the inbound normalization boundary). No-ops when
 * the message carried no token, when the token is unknown, or when the
 * conversation already has a gclid (first click wins — a forwarded message must
 * not overwrite the original attribution).
 */
export async function stampConversationClickAttribution(args: {
  conversationId: string;
  refToken: string | null | undefined;
}): Promise<void> {
  try {
    if (!args.refToken) return;

    const resolved = await resolveWaClickToken(args.refToken);
    if (!resolved?.gclid) return;

    const { error } = await supabaseAdmin
      .from("conversations")
      .update({ gclid: resolved.gclid, wbraid: resolved.wbraid })
      .eq("id", args.conversationId)
      .is("gclid", null); // first-click-wins
    if (error) {
      console.error("[wa-attribution] conversation stamp failed:", error.message);
      return;
    }
    console.log(
      `[wa-attribution] stamped gclid on conversation ${args.conversationId} via ${args.refToken}`,
    );
  } catch (err) {
    console.error("[wa-attribution] stamp threw:", err);
  }
}

/**
 * Look up the click ids captured on this phone's WhatsApp conversation. Used at
 * booking time to decide whether a booking is ad-attributable. The newest
 * conversation with a gclid whose created_at is within 90 days of `refTimeMs`
 * (default now — the backfill passes the booking's created_at) wins.
 *
 * Phone matching normalises formats (+91 / 91 / bare 10-digit) via a trailing
 * last-10-digits match against conversations.whatsapp_phone.
 */
export async function findClickIdsForPhone(
  phone: string,
  refTimeMs: number = Date.now(),
): Promise<{ gclid: string | null; wbraid: string | null }> {
  const empty = { gclid: null, wbraid: null };
  try {
    const digits = (phone ?? "").replace(/\D/g, "");
    if (digits.length < 10) return empty;
    const last10 = digits.slice(-10);
    const cutoffIso = new Date(refTimeMs - NINETY_DAYS_MS).toISOString();

    const { data, error } = await supabaseAdmin
      .from("conversations")
      .select("gclid, wbraid, whatsapp_phone, created_at")
      .not("gclid", "is", null)
      .like("whatsapp_phone", `%${last10}`)
      .gte("created_at", cutoffIso) // within the 90-day attribution window
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[wa-attribution] phone lookup failed:", error.message);
      return empty;
    }
    if (!data) return empty;
    return {
      gclid: (data.gclid as string | null) ?? null,
      wbraid: (data.wbraid as string | null) ?? null,
    };
  } catch (err) {
    console.error("[wa-attribution] phone lookup threw:", err);
    return empty;
  }
}

/** Persist the resolved click ids onto the booking row (best-effort, first-write-wins). */
export async function stampBookingClickIds(args: {
  bookingId: string;
  gclid: string;
  wbraid: string | null;
}): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from("bookings")
      .update({ gclid: args.gclid, wbraid: args.wbraid })
      .eq("id", args.bookingId)
      .is("gclid", null); // first-write-wins — don't clobber an existing attribution
    if (error) console.error("[wa-attribution] booking stamp failed:", error.message);
  } catch (err) {
    console.error("[wa-attribution] booking stamp threw:", err);
  }
}

/**
 * Copy the phone's most-recent (≤90d) conversation gclid/wbraid onto a freshly
 * created booking. The single best-effort entry point every booking-creation
 * path calls — a lookup/stamp failure must never fail the booking.
 */
export async function attachClickIdsToBooking(args: {
  bookingId: string | null | undefined;
  phone: string | null | undefined;
  /** Reference time for the 90-day window; default now. */
  refTimeMs?: number;
}): Promise<void> {
  try {
    if (!args.bookingId || !args.phone) return;
    const clickIds = await findClickIdsForPhone(args.phone, args.refTimeMs);
    if (!clickIds.gclid) return;
    await stampBookingClickIds({
      bookingId: args.bookingId,
      gclid: clickIds.gclid,
      wbraid: clickIds.wbraid,
    });
  } catch (err) {
    console.error("[wa-attribution] attachClickIdsToBooking threw:", err);
  }
}
