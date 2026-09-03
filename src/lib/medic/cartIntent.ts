import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CartItemInput, CartQuote } from "./cartPricing";

// Server-side store for an Aarogya (WhatsApp) medic cart between "agent sends a
// Razorpay payment link" and "the payment_link.paid webhook creates the
// booking". Razorpay notes can't carry the full cart and the webhook has no
// client body, so the server-priced cart + quote are frozen here at
// link-creation time and reconstructed by cart_ref (passed in the link notes)
// on capture. The stored quote IS the price-lock — the link is a fixed amount,
// so nothing the patient does can change what they're charged or booked.

export interface MedicCartIntent {
  cart_ref: string;
  conversation_id: string | null;
  customer_id: string | null;
  phone: string;
  items: CartItemInput[];
  payment_mode: "booking_fee" | "full";
  charge_paise: number;
  quote_snapshot: CartQuote;
  flow: string;
  razorpay_payment_link_id: string | null;
  razorpay_order_id: string | null;
  status: "pending" | "consumed";
}

/** Persist a priced cart intent. Returns the cart_ref to stash in link notes. */
export async function createCartIntent(
  supabase: SupabaseClient,
  args: {
    conversationId?: string | null;
    customerId?: string | null;
    phone: string;
    items: CartItemInput[];
    paymentMode: "booking_fee" | "full";
    chargePaise: number;
    quote: CartQuote;
  },
): Promise<{ cartRef: string } | { error: string }> {
  const { data, error } = await supabase
    .from("medic_cart_intents")
    .insert({
      conversation_id: args.conversationId ?? null,
      customer_id: args.customerId ?? null,
      phone: args.phone,
      items: args.items,
      payment_mode: args.paymentMode,
      charge_paise: args.chargePaise,
      quote_snapshot: args.quote,
      flow: "aarogya_medic_cart",
    })
    .select("cart_ref")
    .single();
  if (error) return { error: error.message };
  return { cartRef: (data as { cart_ref: string }).cart_ref };
}

/** Record the Razorpay payment-link id once created (traceability). */
export async function attachLinkToIntent(
  supabase: SupabaseClient,
  cartRef: string,
  paymentLinkId: string,
): Promise<void> {
  await supabase
    .from("medic_cart_intents")
    .update({ razorpay_payment_link_id: paymentLinkId })
    .eq("cart_ref", cartRef);
}

export async function getCartIntentByRef(
  supabase: SupabaseClient,
  cartRef: string,
): Promise<MedicCartIntent | null> {
  const { data } = await supabase
    .from("medic_cart_intents")
    .select("*")
    .eq("cart_ref", cartRef)
    .maybeSingle();
  return (data as MedicCartIntent | null) ?? null;
}

/** Mark the intent consumed + bind it to the paid order (idempotency trace). */
export async function markCartIntentConsumed(
  supabase: SupabaseClient,
  cartRef: string,
  orderId: string | null,
): Promise<void> {
  await supabase
    .from("medic_cart_intents")
    .update({
      status: "consumed",
      razorpay_order_id: orderId,
      consumed_at: new Date().toISOString(),
    })
    .eq("cart_ref", cartRef);
}
