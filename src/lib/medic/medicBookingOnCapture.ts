import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  persistBookingIdempotent,
  alertOnPostCaptureFailure,
} from "@/lib/booking/paymentSafetyNet";
import { sendOpsAlert } from "@/lib/whatsapp/opsAlert";
import { sendBookingConfirmed } from "@/lib/aarogya/meta";
import { sendAarogyaLeadAlert } from "@/lib/booking/meta";
import { formatLeadAlertContext } from "@/lib/booking/contextFormat";
import { BASE_VISIT_CODE } from "./cartPricing";
import { getCartIntentByRef, markCartIntentConsumed } from "./cartIntent";

// Aarogya Medic-at-Home create-on-capture.
//
// Runs from the Razorpay `payment_link.paid` webhook (signature-verified at the
// envelope) — the ONLY trust anchor for "payment received" (§5.3). It rebuilds
// the exact booking + booking_items from the server-priced cart intent (the
// price-lock), using the same #160-hardened persist path the app/web verify
// routes use. Idempotent on razorpay_order_id, LOUD on any post-capture
// failure, and never trusts anything the patient said in chat.

export interface MedicCaptureArgs {
  cartRef: string;
  /** payment.entity.order_id — the booking idempotency key. */
  orderId: string;
  paymentId: string;
  /** payment.entity.amount actually captured (paise). */
  amountPaise: number;
  contact: string | null;
}

export interface MedicCaptureDeps {
  supabase: SupabaseClient;
  sendOpsAlertFn?: typeof sendOpsAlert;
  sendBookingConfirmedFn?: typeof sendBookingConfirmed;
  sendAarogyaLeadAlertFn?: typeof sendAarogyaLeadAlert;
  now?: Date;
}

export type MedicCaptureAction =
  | "no_intent" // cart_ref didn't resolve — alerted, ops reconciles
  | "created" // full booking created
  | "already_present" // idempotent replay / webhook retry
  | "persist_failed"; // DB write failed (persistBookingIdempotent already alerted)

export interface MedicCaptureResult {
  action: MedicCaptureAction;
  bookingId?: string;
  bookingCode?: string | null;
}

const ADDRESS_PLACEHOLDER = "[Address pending — collect on coordination call]";

export async function createMedicBookingFromCapture(
  args: MedicCaptureArgs,
  deps: MedicCaptureDeps,
): Promise<MedicCaptureResult> {
  const { supabase } = deps;
  const nowIso = (deps.now ?? new Date()).toISOString();
  const sendOpsAlertFn = deps.sendOpsAlertFn ?? sendOpsAlert;

  // 1. Reconstruct the paid cart from its server-side intent.
  const intent = await getCartIntentByRef(supabase, args.cartRef);
  if (!intent) {
    // Money captured but we can't rebuild the cart — never silent (§8). The
    // orphan reconciler will also stub it; here we alert so ops reconciles now.
    await alertOnPostCaptureFailure(
      {
        orderId: args.orderId,
        paymentId: args.paymentId,
        amountPaise: args.amountPaise,
        contact: args.contact,
        serviceDisplay: "Medic at Home",
        reason: `Aarogya medic cart intent ${args.cartRef} not found — cannot reconstruct cart`,
      },
      { sendOpsAlertFn },
    );
    return { action: "no_intent" };
  }

  const quote = intent.quote_snapshot;
  const chargedPaise = args.amountPaise;
  const prepayPaise = quote.prepay_paise;
  const atVisitPaise = quote.at_visit_paise;
  const knownBalancePaise = Math.max(0, prepayPaise - chargedPaise);

  // 2. Integrity: the captured amount must equal the server-locked charge. The
  //    link is a fixed amount, so drift is near-impossible (fraud OR a bug) —
  //    flag it loudly but STILL book (the money is in; §8 no silent drop).
  const flags: string[] = [];
  if (chargedPaise !== intent.charge_paise) {
    const msg = `⚠ AMOUNT DRIFT — captured ₹${Math.round(
      chargedPaise / 100,
    )} vs server-locked ₹${Math.round(intent.charge_paise / 100)}.`;
    flags.push(msg);
    await sendOpsAlertFn({
      conversationId: null,
      escalationId: null,
      patientName: "⚠ MEDIC LINK AMOUNT DRIFT",
      patientAge: "—",
      serviceDisplay: "Medic at Home",
      location: "Booked with the captured amount — verify / refund if wrong",
      context: `${msg} order ${args.orderId}, payment ${args.paymentId}, cart ${args.cartRef}`,
      patientMobile: intent.phone || args.contact || "unknown",
    });
  }

  // 3. Resolve the patient name from the customer record on the intent.
  let patientName = "[Name pending — collect on coordination call]";
  if (intent.customer_id) {
    const { data: cust } = await supabase
      .from("customers")
      .select("full_name")
      .eq("id", intent.customer_id)
      .maybeSingle();
    const fullName = (cust as { full_name?: string | null } | null)?.full_name;
    if (fullName && fullName.trim()) patientName = fullName.trim();
  }

  const summary = quote.line_items
    .filter((l) => l.code !== BASE_VISIT_CODE)
    .map((l) => `${l.name ?? l.code}×${l.qty}`)
    .join(", ");
  const modeLabel =
    intent.payment_mode === "booking_fee" ? "₹100 booking fee" : "full prepay";
  const baseOpsNotes =
    `🏠 Aarogya medic-at-home cart. ${summary || "base visit"}. ` +
    `Paid ₹${Math.round(chargedPaise / 100)} now (${modeLabel}).` +
    (knownBalancePaise > 0
      ? ` Balance ₹${Math.round(knownBalancePaise / 100)} due at/after the visit.`
      : "") +
    (atVisitPaise > 0
      ? ` Plus ₹${Math.round(atVisitPaise / 100)} variable settled at visit.`
      : "") +
    " Booked over WhatsApp; schedule + address on the coordination call.";
  const opsNotes = [flags.join("\n"), baseOpsNotes].filter(Boolean).join("\n");

  // 4. Persist via the shared #160-hardened, idempotent, LOUD write.
  const insertPayload = {
    patient_name: patientName,
    phone: intent.phone || args.contact || "unknown",
    customer_id: intent.customer_id,
    member_id: null,
    service_category: "medic-at-home",
    manual_address: ADDRESS_PLACEHOLDER,
    gps_location: null,
    ops_notes: opsNotes,
    amount: Math.round(chargedPaise / 100),
    scheduled_for: null,
    status: "CONFIRMED",
    razorpay_order_id: args.orderId,
    razorpay_payment_id: args.paymentId,
    payment_status: "CAPTURED",
    booking_fee_paid_paise: chargedPaise,
    payment_captured_at: nowIso,
    otp_verified_at: null,
  };

  const persist = await persistBookingIdempotent(insertPayload, args.orderId, {
    supabase,
    sendOpsAlertFn,
  });
  if (!persist.ok) {
    return { action: "persist_failed" };
  }
  const bookingId = persist.bookingId as string;
  const bookingCode = persist.bookingCode ?? null;

  // 5. Snapshot booking_items (idempotent — skip if already written).
  const { data: existingItems } = await supabase
    .from("booking_items")
    .select("id")
    .eq("booking_id", bookingId)
    .limit(1);
  if (!existingItems || existingItems.length === 0) {
    const rows = quote.line_items.map((l) => ({
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
    const { error: itemsErr } = await supabase.from("booking_items").insert(rows);
    if (itemsErr) {
      console.error(
        `[medicBookingOnCapture] booking_items insert failed for ${bookingCode ?? bookingId}:`,
        itemsErr,
      );
    }
  }

  await markCartIntentConsumed(supabase, intent.cart_ref, args.orderId);

  // 6. Confirmations — ONLY on a genuinely new booking (mirror verify's guard
  //    so a webhook retry / verify race can't double-notify). Fires BOTH the
  //    patient booking-confirmation AND the ops aarogya_lead_alert (§5.5).
  if (persist.wasNewlyInserted) {
    const sendBookingConfirmedFn =
      deps.sendBookingConfirmedFn ?? sendBookingConfirmed;
    const sendAarogyaLeadAlertFn =
      deps.sendAarogyaLeadAlertFn ?? sendAarogyaLeadAlert;
    await Promise.allSettled([
      sendBookingConfirmedFn({
        patientName,
        serviceSlug: "medic-at-home",
        bookingCode: bookingCode ?? "",
        patientPhone: intent.phone,
      }),
      sendAarogyaLeadAlertFn({
        patientName,
        serviceDisplayName: "Medic at Home",
        location: ADDRESS_PLACEHOLDER,
        context: formatLeadAlertContext(summary || "medic-at-home cart", {
          paidPaise: chargedPaise,
          totalPaise: prepayPaise,
          mode: "partial-advance-50",
        }),
        patientPhone: intent.phone,
      }),
    ]);
  }

  return {
    action: persist.wasNewlyInserted ? "created" : "already_present",
    bookingId,
    bookingCode,
  };
}
