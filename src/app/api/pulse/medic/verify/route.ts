import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import { resolveCustomerById } from "@/app/pulse/_lib/getCurrentCustomer";
import { verifyPaymentSignature, getRazorpayClient } from "@/lib/razorpay";
import { validatePatientName } from "@/lib/booking/customerLink";
import { sendOpsAlert } from "@/lib/whatsapp/opsAlert";
import {
  persistBookingIdempotent,
  alertOnPostCaptureFailure,
} from "@/lib/booking/paymentSafetyNet";
import { attachClickIdsToBooking } from "@/lib/wa/attribution";
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
 * PB5a — native (bearer) medic-cart booking. Post-#159 parity: once the
 * Razorpay signature verifies the money is captured, so this route NEVER drops
 * a proven-paid transaction silently:
 *   - Signature is verified FIRST — ahead of auth.
 *   - Auth is SOFT: a valid signature with a failed/expired session does not
 *     401; the booking is persisted with the identity recovered from the order
 *     notes (customer_id) + a loud ops alert.
 *   - Recoverable validation (member/name/address) → persist-and-flag, not a
 *     400 that would lose the paid booking.
 *   - The cart/amount integrity check stays a HARD stop (anti-fraud) but fires
 *     a loud ops alert on mismatch (fraud OR a legit mid-session catalog change
 *     — ops can refund/rebook). The expected charge is price-locked from
 *     order.notes.charge_paise so a later catalog change can't false-positive.
 *   - The booking write is idempotent + LOUD (persistBookingIdempotent).
 *
 * Body:
 *   { razorpay_order_id, razorpay_payment_id, razorpay_signature,
 *     items: [{ code, qty, units?, hours? }], booking: { member_id?, manual_address } }
 */
export async function POST(req: NextRequest) {
  try {
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

    // === Signature verification FIRST (money is captured once this passes) ===
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
      await alertOnPostCaptureFailure({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        serviceDisplay: "Medic at Home",
        reason: "Supabase credentials missing on /api/pulse/medic/verify",
      });
      return NextResponse.json({ error: "Server credentials missing" }, { status: 500 });
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // === Auth is SOFT — never 401 a proven-paid booking ===
    const auth = await requirePulseCustomer(req);
    const authedCustomer = "customer" in auth ? auth.customer : null;

    // === Recompute the quote server-side (never trust a client total) ===
    const items = normalizeCartItems(body?.items);
    if (items.length === 0) {
      // No items → we can't verify the cart the payment was for. Don't auto-book
      // an unverifiable cart, but the money IS captured — alert loudly so ops
      // reconciles (the orphan reconciler will also stub it).
      await alertOnPostCaptureFailure({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        contact: authedCustomer?.phone ?? null,
        serviceDisplay: "Medic at Home",
        reason: "Empty cart at verify — cannot reconcile paid cart",
      });
      return NextResponse.json({ error: "Cart is empty." }, { status: 400 });
    }
    const { quote } = await loadAndQuoteCart(supabase, items);

    // === Bind to the paid order — fetch notes for amount + cart + identity ===
    let orderAmount = 0;
    let notes: Record<string, unknown> = {};
    try {
      const order = await getRazorpayClient().orders.fetch(razorpay_order_id);
      orderAmount = Number(order.amount);
      notes = (order.notes ?? {}) as Record<string, unknown>;
    } catch (e) {
      // Can't fetch the order → can't run the anti-fraud integrity check. Hard
      // stop, but LOUD (money captured; reconciler will also catch it).
      console.error("[pulse/medic/verify] order fetch failed", razorpay_order_id, e);
      await alertOnPostCaptureFailure({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        contact: authedCustomer?.phone ?? null,
        serviceDisplay: "Medic at Home",
        reason: "Razorpay order fetch failed — integrity uncheckable",
      });
      return NextResponse.json({ error: "Could not verify the order." }, { status: 400 });
    }

    // === Integrity: flow + cart + amount must match (HARD stop + LOUD) ===
    // Amount is PRICE-LOCKED from notes.charge_paise (computed once at
    // create-order), so a catalog price change between create-order and verify
    // can't false-positive. Fall back to a live re-quote only for legacy orders
    // created before charge_paise was stashed.
    const paymentMode = normalizePaymentMode(notes.payment_mode);
    const lockedCharge = Number(notes.charge_paise);
    const expectedCharge =
      Number.isFinite(lockedCharge) && lockedCharge > 0
        ? lockedCharge
        : paymentMode === "booking_fee" && quote.prepay_paise > MEDIC_BOOKING_FEE_PAISE
          ? MEDIC_BOOKING_FEE_PAISE
          : quote.prepay_paise;
    const cartMatches = String(notes.cart_hash ?? "") === cartHash(items);
    const amountMatches = expectedCharge === orderAmount;
    const flowMatches = notes.flow === "pb5_medic_cart";
    if (!flowMatches || !cartMatches || !amountMatches) {
      const reason = `Cart/amount integrity mismatch (flow=${String(
        notes.flow,
      )} mode=${paymentMode} amountMatches=${amountMatches} cartMatches=${cartMatches}; expected ₹${(
        expectedCharge / 100
      ).toFixed(0)}, captured ₹${(orderAmount / 100).toFixed(0)})`;
      console.error(`[pulse/medic/verify] ${reason} order=${razorpay_order_id}`);
      await alertOnPostCaptureFailure({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        amountPaise: orderAmount,
        contact: authedCustomer?.phone ?? null,
        serviceDisplay: "Medic at Home",
        reason: `${reason} — possible fraud OR mid-session catalog change; refund or rebook`,
      });
      return NextResponse.json(
        { error: "Payment could not be reconciled with the cart. Please contact support." },
        { status: 400 },
      );
    }

    // === Resolve identity ===
    // Authed → the signed-in customer. Auth failed but signature valid → recover
    // the customer from the order notes (create-order stashed customer_id) and
    // FLAG it; the booking still lands.
    const flags: string[] = [];
    let customerId: string | null = null;
    let customerPhone = "";
    let selfName: string | null = null;
    if (authedCustomer) {
      customerId = authedCustomer.id;
      customerPhone = authedCustomer.phone;
      selfName = authedCustomer.full_name;
    } else {
      flags.push(
        "⚠ SESSION EXPIRED at verify — identity recovered from the paid order; confirm patient identity.",
      );
      const notesCustomerId =
        typeof notes.customer_id === "string" ? notes.customer_id : null;
      if (notesCustomerId) {
        const recovered = await resolveCustomerById(notesCustomerId).catch(() => null);
        if (recovered) {
          customerId = recovered.id;
          customerPhone = recovered.phone;
          selfName = recovered.full_name;
        }
      }
    }

    // === Resolve patient (self, or a validated family member) ===
    // Member validation needs a trusted signed-in customer for the IDOR guard;
    // on the soft-auth path we skip it and book under the recovered self.
    const memberIdRaw =
      typeof booking.member_id === "string" && booking.member_id.trim()
        ? booking.member_id.trim()
        : null;
    let memberId: string | null = null;
    let rawPatientName: string | null = selfName;
    if (memberIdRaw && authedCustomer) {
      const { data: member } = await supabase
        .from("family_members")
        .select("id, name")
        .eq("id", memberIdRaw)
        .eq("customer_id", authedCustomer.id) // IDOR guard
        .maybeSingle();
      if (member) {
        memberId = member.id as string;
        rawPatientName = member.name as string;
      } else {
        // Recoverable — book under self + flag instead of a 400 that loses the pay.
        flags.push(
          "⚠ MEMBER NOT VALIDATED — the selected family member isn't on this account; booked under the account holder.",
        );
      }
    } else if (memberIdRaw && !authedCustomer) {
      flags.push("⚠ MEMBER NOT VALIDATED (session expired) — booked under the recovered account.");
    }

    // === Recoverable validation → persist-and-flag (never a 400 post-capture) ===
    const nameValidation = validatePatientName(rawPatientName);
    const patientName = nameValidation.ok
      ? nameValidation.name
      : "[Name pending — collect from patient]";
    if (!nameValidation.ok) flags.push("⚠ NAME NOT CAPTURED — collect patient name.");

    let manualAddress = String(booking.manual_address ?? "").trim();
    if (manualAddress.length < 4) {
      flags.push("⚠ ADDRESS MISSING/SHORT — collect the home-visit address before dispatch.");
      manualAddress = "[Address pending — collect from patient]";
    }

    // === Persist booking (service-role; payment just verified) ===
    const prepayPaise = quote.prepay_paise;
    const atVisitPaise = quote.at_visit_paise;
    const chargedPaise = orderAmount; // what Razorpay actually captured now
    const knownBalancePaise = Math.max(0, prepayPaise - chargedPaise);
    const summary = quote.line_items
      .filter((l) => l.code !== "__base_visit__")
      .map((l) => `${l.name ?? l.code}×${l.qty}`)
      .join(", ");
    const modeLabel = paymentMode === "booking_fee" ? "₹100 booking fee" : "full prepay";
    const baseOpsNotes =
      `🏠 Pulse medic-at-home cart. ${summary || "base visit"}. ` +
      `Paid ₹${(chargedPaise / 100).toFixed(0)} now (${modeLabel}).` +
      (knownBalancePaise > 0
        ? ` Balance ₹${(knownBalancePaise / 100).toFixed(0)} due at/after the visit.`
        : "") +
      (atVisitPaise > 0
        ? ` Plus ₹${(atVisitPaise / 100).toFixed(0)} variable settled at visit.`
        : "") +
      " Scheduled on the coordination call.";
    const opsNotes = [flags.join("\n"), baseOpsNotes].filter(Boolean).join("\n");

    const insertPayload = {
      patient_name: patientName,
      phone: customerPhone || "unknown",
      customer_id: customerId,
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
      otp_verified_at: authedCustomer ? new Date().toISOString() : null,
    };

    // Idempotent + LOUD write (fires the ops alert itself on any DB failure).
    const persist = await persistBookingIdempotent(insertPayload, razorpay_order_id, {
      supabase,
    });
    if (!persist.ok) {
      console.error("[pulse/medic/verify] booking persist failed (ops alerted):", persist.error);
      return NextResponse.json(
        {
          error: "Payment captured but booking could not be saved. Please contact support.",
          razorpay_payment_id,
        },
        { status: 500 },
      );
    }
    const bookingId = persist.bookingId as string;
    const bookingCode = persist.bookingCode ?? null;

    // Paid attribution — copy the phone's recent WhatsApp gclid onto the booking.
    await attachClickIdsToBooking({ bookingId, phone: customerPhone });

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
        console.error(
          `[pulse/medic/verify] booking_items insert failed for ${bookingCode ?? bookingId}:`,
          itemsErr,
        );
      }
    }

    // === Ops alert (best-effort; sendOpsAlert never throws) ===
    // Only on a genuinely new booking — the idempotent-upgrade path already
    // alerted (webhook stub) / booked. Flags are surfaced in the context.
    if (persist.wasNewlyInserted) {
      try {
        await sendOpsAlert({
          conversationId: null,
          escalationId: null,
          patientName,
          patientAge: "—",
          serviceDisplay: "Medic at Home",
          location: manualAddress,
          context:
            (flags.length ? `${flags.join(" ")} · ` : "") +
            `${bookingCode ?? bookingId}: ${summary || "base visit"} · paid ₹${(
              chargedPaise / 100
            ).toFixed(0)} (${modeLabel})` +
            (knownBalancePaise > 0 ? ` · bal ₹${(knownBalancePaise / 100).toFixed(0)}` : "") +
            (atVisitPaise > 0 ? ` (+₹${(atVisitPaise / 100).toFixed(0)} at visit)` : ""),
          patientMobile: customerPhone || "unknown",
        });
      } catch (alertErr) {
        console.error("[pulse/medic/verify] ops alert threw (non-fatal)", alertErr);
      }
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
