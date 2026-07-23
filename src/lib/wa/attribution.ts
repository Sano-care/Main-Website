import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";

import { extractWaRefToken, resolveWaClickToken } from "@/lib/wa/clickToken";

// Click-attribution stamping for the WhatsApp funnel.
//
//   inbound message  →  [ref: SC-XXXXXX]  →  wa_click_tokens  →  conversations.gclid
//   razorpay verify  →  conversations.gclid (by phone)        →  bookings.gclid
//
// Everything here is best-effort: attribution must never block a WhatsApp reply
// or a payment response. Failures log and return quietly.

/**
 * Extract a `[ref: …]` token from an inbound message and, if it resolves, stamp
 * the click ids onto the conversation. No-ops when the message carries no token
 * (the overwhelming majority), when the token is unknown, or when the
 * conversation already has a gclid (first click wins — don't let a forwarded
 * message overwrite the original attribution).
 */
export async function stampConversationClickAttribution(args: {
  conversationId: string;
  text: string | null | undefined;
}): Promise<void> {
  try {
    const token = extractWaRefToken(args.text);
    if (!token) return;

    const resolved = await resolveWaClickToken(token);
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
    console.log(`[wa-attribution] stamped gclid on conversation ${args.conversationId} via ${token}`);
  } catch (err) {
    console.error("[wa-attribution] stamp threw:", err);
  }
}

/**
 * Look up the click ids captured on this phone's WhatsApp conversation. Used at
 * payment time to decide whether a booking is ad-attributable. Newest
 * conversation with a gclid wins.
 */
export async function findClickIdsForPhone(
  phone: string,
): Promise<{ gclid: string | null; wbraid: string | null }> {
  const empty = { gclid: null, wbraid: null };
  try {
    const digits = (phone ?? "").replace(/\D/g, "");
    if (digits.length < 10) return empty;
    const last10 = digits.slice(-10);

    const { data, error } = await supabaseAdmin
      .from("conversations")
      .select("gclid, wbraid, whatsapp_phone, updated_at")
      .not("gclid", "is", null)
      .like("whatsapp_phone", `%${last10}`)
      .order("updated_at", { ascending: false })
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

/** Persist the resolved click ids onto the booking row (best-effort). */
export async function stampBookingClickIds(args: {
  bookingId: string;
  gclid: string;
  wbraid: string | null;
}): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from("bookings")
      .update({ gclid: args.gclid, wbraid: args.wbraid })
      .eq("id", args.bookingId);
    if (error) console.error("[wa-attribution] booking stamp failed:", error.message);
  } catch (err) {
    console.error("[wa-attribution] booking stamp threw:", err);
  }
}
