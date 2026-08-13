import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import { getRazorpayClient } from "@/lib/razorpay";
import {
  loadAndQuoteCart,
  normalizeCartItems,
  cartHash,
} from "@/lib/medic/serverCart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/pulse/medic/create-order
 *
 * Server-authoritative Razorpay order for the medic cart. Runs the pricing
 * engine, charges `prepay_paise` (the known/floor amount; variable extras are
 * settled at visit), and binds the exact cart to the order via a `cart_hash`
 * in notes so /verify cannot be tricked. No DB write — the booking is only
 * persisted after /verify (mirrors the web + teleconsult "no ghost bookings"
 * rule).
 *
 * Body: { items: [{ code, qty, units?, hours? }] }
 * 200 { orderId, amount, currency, keyId, quote, rx }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePulseCustomer(req);
    if ("response" in auth) return auth.response;
    const { customer } = auth;

    const body = await req.json().catch(() => null);
    const items = normalizeCartItems(body?.items);
    if (items.length === 0) {
      return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: "Server credentials missing" }, { status: 500 });
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { quote, rxYes, rxCaseByCase } = await loadAndQuoteCart(supabase, items);
    if (quote.prepay_paise <= 0) {
      return NextResponse.json(
        { error: "Those items aren't available right now." },
        { status: 400 },
      );
    }

    const razorpay = getRazorpayClient();
    const receipt = `snc_medic_${Date.now().toString(36).slice(-8)}`;
    const order = await razorpay.orders.create({
      amount: quote.prepay_paise, // paise; the amount actually captured now
      currency: "INR",
      receipt,
      notes: {
        flow: "pb5_medic_cart",
        source: "pulse-app/medic-at-home",
        customer_id: customer.id,
        // Binds the paid cart to the order — re-checked in /verify.
        cart_hash: cartHash(items),
        prepay_paise: String(quote.prepay_paise),
        at_visit_paise: String(quote.at_visit_paise),
        item_count: String(items.length),
      },
    });

    return NextResponse.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
      quote,
      rx: { required: rxYes, caseByCase: rxCaseByCase },
    });
  } catch (err) {
    console.error("[pulse/medic/create-order] error:", err);
    const message = err instanceof Error ? err.message : "Failed to create order";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
