// Closed-loop hook: when a booking is created, link it back to the marketing
// lead that drove it (matched by normalized phone), flip the lead to `booked`,
// and roll its lifetime_value_paise up. Soft-fail — a marketing-attribution miss
// must never break the booking flow.

import { supabaseAdmin } from "@/lib/supabase-server";
import { log } from "@/lib/whatsapp/log";
import { normalizePhone } from "./types";

type SupabaseLike = typeof supabaseAdmin;

export interface LinkBookingArgs {
  phone: string | null | undefined;
  bookingId: string;
  /** Booking value in PAISE to roll into lifetime_value_paise. Callers pass the
   *  paise amount directly (final_amount_paise, else round(amount_rupees*100)). */
  amountPaise?: number | null;
}

export interface LinkBookingDeps {
  supabase?: SupabaseLike;
}

export async function linkBookingToMarketingLead(
  args: LinkBookingArgs,
  deps: LinkBookingDeps = {},
): Promise<{ linked: boolean }> {
  const supabase = deps.supabase ?? supabaseAdmin;
  try {
    const normalized = normalizePhone(args.phone);
    if (!normalized) return { linked: false };

    const { data: existing, error: readErr } = await supabase
      .from("marketing_leads")
      .select("id, lifetime_value_paise")
      .eq("normalized_phone", normalized)
      .maybeSingle();
    if (readErr) {
      log.error("linkBookingToMarketingLead read failed", readErr.message);
      return { linked: false };
    }
    if (!existing) return { linked: false }; // no marketing lead for this phone

    const rolledUp =
      Number((existing as { lifetime_value_paise: number }).lifetime_value_paise ?? 0) +
      Math.round(args.amountPaise ?? 0);
    const { error: updErr } = await supabase
      .from("marketing_leads")
      .update({
        state: "booked",
        linked_booking_id: args.bookingId,
        lifetime_value_paise: rolledUp,
      })
      .eq("id", (existing as { id: string }).id);
    if (updErr) {
      log.error("linkBookingToMarketingLead update failed", updErr.message);
      return { linked: false };
    }
    return { linked: true };
  } catch (e) {
    log.error("linkBookingToMarketingLead threw", e instanceof Error ? e.message : String(e));
    return { linked: false };
  }
}
