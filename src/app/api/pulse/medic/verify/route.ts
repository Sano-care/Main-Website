import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import { verifyPaymentSignature, getRazorpayClient } from "@/lib/razorpay";
import { validatePatientName } from "@/lib/booking/customerLink";
import { sendOpsAlert } from "@/lib/whatsapp/opsAlert";
import {
  loadAndQuoteCart,
  normalizeCartItems,
  cartHash,
  normalizePaymentMode,
  MEDIC_BOOKING_FEE_PAISE,
} from "@/lib/medic/serverCart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/pulse/medic/verify
 *
 * PB5a — native (bearer) medic-cart booking. Mirrors the teleconsult verify:
 * signature verify + #140 idempotency on razorpay_order_id, authed via
 * requirePulseCustomer, scoped to the caller's own customer + validated member.
 *
 * Money is server-authoritative end to end:
 *   1. Recompute the quote from the (untrusted) cart in the body.
 *   2. Fetch the order from Razorpay and require BOTH:
 *        recomputed prepay_paise === order.amount   (paid amount matches), and
 *        cartHash(items) === order.notes.cart_hash   (cart matches what was paid).
 *   A mismatch never writes a booking.
 *
 * Body:
 *   {
 *     razorpay_order_id, razorpay_payment_id, razorpay_signature,
 *     items: [{ code, qty, units?, hours? }],
 *     booking: { member_id?, manual_address }
 *   }
 *   200 { ok, bookingId, bookingCode, prepayPaise, atVisitPaise }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePulseCustomer(req);
    if ("response" in auth) return auth.response;
    const { customer } = auth;

    const body = await req.json().catch(() => null);
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      booking,
    } = body ?? {};

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json({ error: "Missing Razorpay payment fields" }, { status: 400 });
    }
    if (!booking || typeof booking !== "object") {
      return NextResponse.json({ error: "Missing booking" }, { status: 400 });
    }

    // === Signature verification (secret stays server-side) ===
    const valid = verifyPaymentSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });
    if (!valid) {
      console.warn("[pulse/medic/verify] signature mismatch for order", razorpay_order_id);
      return NextResponse.json({ error: "Payment signature invalid" }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: "Server credentials missing" }, { status: 500 });
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // === Recompute the quote server-side (never trust a client total) ===
    const items = normalizeCartItems(body?.items);
    if (items.length === 0) {
      return NextResponse.json({ error: "Cart is empty." }, { status: 400 });
    }
    const { quote } = await loadAndQuoteCart(supabase, items);

    // === Bind to the paid order — amount AND cart must match ===
    let orderAmount = 0;
    let notes: Record<string, unknown> = {};
    try {
      const order = await getRazorpayClient().orders.fetch(razorpay_order_id);
      orderAmount = Number(order.amount);
      notes = (order.notes ?? {}) as Record<string, unknown>;
    } catch (e) {
      console.error("[pulse/medic/verify] order fetch failed", razorpay_order_id, e);
      return NextResponse.json({ error: "Could not verify the order." }, { status: 400 });
    }
    // Dual payment: the order was for either the flat ₹100 booking fee or the
    // full prepay. Re-derive the expected charge server-side from the recomputed
    // prepay + the mode stored in notes, and require the captured amount to match
    // it exactly (never trust the client for the amount).
    const paymentMode = normalizePaymentMode(notes.payment_mode);
    const expectedCharge =
      paymentMode === "booking_fee" && quote.prepay_paise > MEDIC_BOOKING_FEE_PAISE
        ? MEDIC_BOOKING_FEE_PAISE
        : quote.prepay_paise;
    const cartMatches = String(notes.cart_hash ?? "") === cartHash(items);
    const amountMatches = expectedCharge === orderAmount;
    if (notes.flow !== "pb5_medic_cart" || !cartMatches || !amountMatches) {
      console.error(
        `[pulse/medic/verify] integrity check failed order=${razorpay_order_id} flow=${String(
          notes.flow,
        )} mode=${paymentMode} amountMatches=${amountMatches} cartMatches=${cartMatches}`,
      );
      return NextResponse.json(
        { error: "Payment could not be reconciled with the cart. Please contact support." },
        { status: 400 },
      );
    }

    // === Resolve patient (self or a validated family member) ===
    const memberIdRaw =
      typeof booking.member_id === "string" && booking.member_id.trim()
        ? booking.member_id.trim()
        : null;
    let memberId: string | null = null;
    let rawPatientName: string | null = customer.full_name;
    if (memberIdRaw) {
      const { data: member } = await supabase
        .from("family_members")
        .select("id, name")
        .eq("id", memberIdRaw)
        .eq("customer_id", customer.id) // IDOR guard
        .maybeSingle();
      if (!member) {
        return NextResponse.json(
          { error: "That family member isn't on your account." },
          { status: 400 },
        );
      }
      memberId = member.id as string;
      rawPatientName = member.name as string;
    }
    const nameValidation = validatePatientName(rawPatientName);
    if (!nameValidation.ok) {
      return NextResponse.json({ error: nameValidation.error }, { status: 400 });
    }

    const manualAddress = String(booking.manual_address ?? "").trim();
    if (manualAddress.length < 4) {
      return NextResponse.json(
        { error: "Please enter an address (required for the home visit)." },
        { status: 400 },
      );
    }

    // === Persist booking (service-role; payment just verified) ===
    const prepayPaise = quote.prepay_paise;
    const atVisitPaise = quote.at_visit_paise;
    const chargedPaise = orderAmount; // what Razorpay actually captured now
    // Known balance = the rest of the computed prepay not captured now (0 in full
    // mode; prepay − ₹100 in booking-fee mode). The at-visit variable is on top.
    const knownBalancePaise = Math.max(0, prepayPaise - chargedPaise);
    const summary = quote.line_items
      .filter((l) => l.code !== "__base_visit__")
      .map((l) => `${l.name ?? l.code}×${l.qty}`)
      .join(", ");
    const modeLabel = paymentMode === "booking_fee" ? "₹100 booking fee" : "full prepay";
    const opsNotes =
      `🏠 Pulse medic-at-home cart. ${summary || "base visit"}. ` +
      `Paid ₹${(chargedPaise / 100).toFixed(0)} now (${modeLabel}).` +
      (knownBalancePaise > 0
        ? ` Balance ₹${(knownBalancePaise / 100).toFixed(0)} due at/after the visit.`
        : "") +
      (atVisitPaise > 0
        ? ` Plus ₹${(atVisitPaise / 100).toFixed(0)} variable settled at visit.`
        : "") +
      " Scheduled on the coordination call.";

    const insertPayload = {
      patient_name: nameValidation.name,
      phone: customer.phone,
      customer_id: customer.id,
      member_id: memberId,
      service_category: "medic-at-home",
      manual_address: manualAddress,
      gps_location: null,
      ops_notes: opsNotes,
      amount: Math.round(chargedPaise / 100), // rupees captured now
      scheduled_for: null, // set on the coordination call
      status: "CONFIRMED",
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      payment_status: "CAPTURED",
      booking_fee_paid_paise: chargedPaise,
      payment_captured_at: new Date().toISOString(),
      otp_verified_at: new Date().toISOString(), // bearer session ⇒ prior OTP verify
    };

    // Idempotent insert — partial unique index on bookings(razorpay_order_id)
    // (#140) guarantees one booking per order across double-submits / webhook.
    const inserted = await supabase
      .from("bookings")
      .insert(insertPayload)
      .select("id, booking_code")
      .single();
    let data = inserted.data;
    let error = inserted.error;

    if (error && (error as { code?: string }).code === "23505") {
      const upgraded = await supabase
        .from("bookings")
        .update(insertPayload)
        .eq("razorpay_order_id", razorpay_order_id)
        .select("id, booking_code")
        .single();
      data = upgraded.data;
      error = upgraded.error;
      console.info("[pulse/medic/verify] order already had a booking — upgraded", razorpay_order_id);
    }

    if (error || !data) {
      console.error("[pulse/medic/verify] booking insert failed:", error);
      return NextResponse.json(
        {
          error: "Payment captured but booking could not be saved. Please contact support.",
          razorpay_payment_id,
        },
        { status: 500 },
      );
    }

    const bookingId = data.id as string;
    const bookingCode = (data.booking_code as string | null) ?? null;

    // === Snapshot line items (idempotent — skip if already written) ===
    const { data: existingItems } = await supabase
      .from("booking_items")
      .select("id")
      .eq("booking_id", bookingId)
      .limit(1);
    if (!existingItems || existingItems.length === 0) {
      const itemRows = quote.line_items.map((l) => ({
        booking_id: bookingId,
        procedure_code: l.code,
        procedure_name: l.name,
        tier: l.tier,
        qty: l.qty,
        unit_price_paise: l.unit_price_paise,
        line_total_paise: l.line_total_paise,
        is_variable: l.is_variable,
        meta: l.meta ?? null,
      }));
      const { error: itemsErr } = await supabase.from("booking_items").insert(itemRows);
      if (itemsErr) {
        // Booking + payment are saved — never 500 for a snapshot failure. Log so
        // ops can reconcile the line items from the Razorpay order if needed.
        console.error(
          `[pulse/medic/verify] booking_items insert failed for ${bookingCode ?? bookingId}:`,
          itemsErr,
        );
      }
    }

    // === Ops alert (best-effort; sendOpsAlert never throws) ===
    try {
      await sendOpsAlert({
        conversationId: null,
        escalationId: null,
        patientName: nameValidation.name,
        patientAge: "—",
        serviceDisplay: "Medic at Home",
        location: manualAddress,
        context:
          `${bookingCode ?? bookingId}: ${summary || "base visit"} · paid ₹${(
            chargedPaise / 100
          ).toFixed(0)} (${modeLabel})` +
          (knownBalancePaise > 0 ? ` · bal ₹${(knownBalancePaise / 100).toFixed(0)}` : "") +
          (atVisitPaise > 0 ? ` (+₹${(atVisitPaise / 100).toFixed(0)} at visit)` : ""),
        patientMobile: customer.phone,
      });
    } catch (alertErr) {
      console.error("[pulse/medic/verify] ops alert threw (non-fatal)", alertErr);
    }

    return NextResponse.json({
      ok: true,
      bookingId,
      bookingCode,
      paymentMode,
      chargedPaise,
      prepayPaise,
      atVisitPaise,
      balancePaise: knownBalancePaise,
    });
  } catch (err) {
    console.error("[pulse/medic/verify] error:", err);
    const message = err instanceof Error ? err.message : "Failed to verify payment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
