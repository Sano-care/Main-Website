// Razorpay revenue safety net.
//
// A booking is written only when the browser calls /api/razorpay/verify
// after Razorpay Checkout succeeds. Razorpay auto-captures the payment, so
// if that verify call never completes (tab close / network drop) the money
// is taken and NO booking row is created — a silent revenue leak (>=4 orphan
// captures Jul 14-19). The /api/razorpay/webhook endpoint is the server-side
// backstop: Razorpay calls it on `payment.captured` regardless of the client,
// so we can guarantee every capture is recorded and ops is alerted.
//
// This module holds the two pieces of that backstop, dependency-injected so
// they are testable without touching Supabase or the WhatsApp BSP (mirrors
// src/lib/marketing/leadEngagement.ts):
//   - ensureBookingForCapturedOrder(): idempotent update-or-create for a
//     captured order. If a booking exists → mark it CAPTURED. If none exists
//     → create a *reconciliation* stub (placeholder patient details, flagged
//     for ops) so the capture is never invisible, then alert ops.
//   - runPaymentLeakMonitor(): a periodic dead-man's switch (pg_cron) that
//     re-alerts if a reconciliation stub sits un-reconciled, or if the whole
//     booking pipeline goes silent for 24h after having been active.
//
// Idempotency is guaranteed at the DB level by the partial unique index on
// bookings(razorpay_order_id) added in the accompanying migration — a
// concurrent webhook retry / webhook-vs-verify race collapses to one row
// (unique violation 23505 is swallowed as success here).

import type { SupabaseClient } from "@supabase/supabase-js";

import { sendOpsAlert } from "@/lib/whatsapp/opsAlert";

/**
 * Marker prefixing `ops_notes` on any booking created by the webhook backstop
 * (verify never ran). The verify route keys off this to know it is *upgrading*
 * a stub rather than writing a fresh booking; the monitor keys off it to find
 * un-reconciled stubs. Keep in sync with the reference in verify/route.ts.
 */
export const WEBHOOK_RECONCILE_MARKER = "🩹 WEBHOOK_RECONCILE";

/** Postgres unique-violation SQLSTATE — the idempotency backstop tripping. */
const PG_UNIQUE_VIOLATION = "23505";

/**
 * Map a Razorpay `notes.flow` to a valid `service_category` when the order
 * notes carry no `t85_slug`/`service_category` of their own. The native flows
 * (pb5_medic_cart) stash neither, so without this the reconciler resolves an
 * invalid "unknown" and the stub insert trips the service_category CHECK — the
 * orphan then errors out instead of being recorded. Web t85 flows +
 * teleconsult (via /api/razorpay/create-order t85_slug) + lab_prepaid all carry
 * t85_slug already, so they never need this fallback. Keep flow strings in sync
 * with the create-order routes.
 */
const FLOW_TO_SERVICE: Record<string, string> = {
  pb5_medic_cart: "medic-at-home",
  t85_lab_prepaid: "lab-tests",
};

/** Report-fee lane (matched by report_razorpay_order_id, handled by the
 *  webhook's lab_report_payment branch) — NOT a booking orphan. The active
 *  reconciler must skip it or it would stub a phantom booking + false-alert. */
const REPORT_PAYMENT_FLOW = "lab_report_payment";

export interface EnsureBookingArgs {
  orderId: string;
  paymentId: string;
  /** payment.entity.amount, in paise. */
  amountPaise: number;
  /** payment.entity.contact, e.g. "+919812345678". May be absent. */
  contact: string | null;
  /** payment.entity.email. May be absent. */
  email: string | null;
}

export interface EnsureBookingDeps {
  supabase: SupabaseClient;
  /**
   * Reads the Razorpay *order* notes (create-order stashes `t85_slug` /
   * `service_category` there). Injected so tests never hit Razorpay. Should
   * resolve to `{}` on any failure — a missing service is non-fatal.
   */
  fetchOrderNotes: (orderId: string) => Promise<Record<string, string>>;
  sendOpsAlertFn?: typeof sendOpsAlert;
  now?: Date;
}

export type EnsureBookingAction =
  | "already_captured" // booking exists + already CAPTURED → no-op
  | "marked_captured" // booking existed (verify won the race) → flipped to CAPTURED
  | "reconciliation_created" // no booking → stub created + ops alerted
  | "race_lost"; // unique index rejected our insert → another writer created it

export interface EnsureBookingResult {
  action: EnsureBookingAction;
  bookingId?: string;
  opsAlerted?: boolean;
}

/**
 * Ensure a booking row exists (and is marked CAPTURED) for a captured Razorpay
 * order. Safe to call repeatedly for the same event — Razorpay retries webhooks
 * until it gets a 2xx, so this MUST be idempotent.
 */
export async function ensureBookingForCapturedOrder(
  args: EnsureBookingArgs,
  deps: EnsureBookingDeps,
): Promise<EnsureBookingResult> {
  const { supabase } = deps;
  const sendOpsAlertFn = deps.sendOpsAlertFn ?? sendOpsAlert;
  const nowIso = (deps.now ?? new Date()).toISOString();

  // --- Does a booking already exist for this order? ---
  const { data: existing } = await supabase
    .from("bookings")
    .select("id, payment_status")
    .eq("razorpay_order_id", args.orderId)
    .maybeSingle();

  if (existing) {
    if (existing.payment_status === "CAPTURED") {
      return { action: "already_captured", bookingId: existing.id as string };
    }
    // Verify created the row but didn't stamp CAPTURED (older path, or a
    // partial write). Flip it. Guarded by .neq so a concurrent flip is a no-op.
    await supabase
      .from("bookings")
      .update({
        razorpay_payment_id: args.paymentId,
        payment_status: "CAPTURED",
        payment_captured_at: nowIso,
      })
      .eq("razorpay_order_id", args.orderId)
      .neq("payment_status", "CAPTURED");
    return { action: "marked_captured", bookingId: existing.id as string };
  }

  // --- No booking → verify never completed. Create a reconciliation stub. ---
  // service_category is NOT NULL; recover it from the order notes create-order
  // stashed, else a sentinel. patient_name / manual_address are unknowable from
  // the payment payload, so they carry ops-visible placeholders.
  const notes = await deps
    .fetchOrderNotes(args.orderId)
    .catch((): Record<string, string> => ({}));
  // Flow-agnostic service resolution: prefer the explicit t85_slug /
  // service_category the web flows stash, then fall back to the flow map so
  // native flows (pb5_medic_cart) resolve a VALID category instead of a CHECK-
  // violating "unknown". 'unknown' remains only for a genuinely unrecognised
  // flow — allowed by the service_category CHECK as a reconciliation sentinel.
  const flow = String(notes.flow ?? "").trim();
  const service =
    (
      notes.t85_slug ||
      notes.service_category ||
      FLOW_TO_SERVICE[flow] ||
      ""
    ).trim() || "unknown";
  const phone = (args.contact ?? "").trim() || "unknown";
  const amountRupees = Math.round(args.amountPaise) / 100;

  const insertPayload = {
    patient_name: "[Webhook — details pending]",
    phone,
    service_category: service,
    manual_address: "[Webhook reconcile — address not captured]",
    amount: amountRupees,
    status: "PENDING",
    razorpay_order_id: args.orderId,
    razorpay_payment_id: args.paymentId,
    payment_status: "CAPTURED",
    booking_fee_paid_paise: Math.round(args.amountPaise),
    payment_captured_at: nowIso,
    ops_notes:
      `${WEBHOOK_RECONCILE_MARKER} Captured payment with NO booking — the ` +
      `patient's browser never completed /api/razorpay/verify. Money is ` +
      `captured; patient details were not persisted. Reconcile manually ` +
      `(order ${args.orderId}, payment ${args.paymentId}${
        args.email ? `, email ${args.email}` : ""
      }).`,
  };

  const { data: inserted, error } = await supabase
    .from("bookings")
    .insert(insertPayload)
    .select("id")
    .single();

  if (error) {
    // 23505 = the partial unique index rejected us: verify (or a concurrent
    // webhook retry) created the row in the tiny window since our SELECT. That
    // is exactly the outcome we want — one row per order — so treat as success.
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { action: "race_lost" };
    }
    throw error; // real failure — webhook logs it and still ACKs 200.
  }

  // Loudly tell ops: money in, booking incomplete. Best-effort; sendOpsAlert
  // never throws (retries + OPS_ALERT_FAILED audit on total failure).
  const alert = await sendOpsAlertFn({
    conversationId: null,
    escalationId: null,
    patientName: "⚠ ORPHAN PAYMENT",
    patientAge: "—",
    serviceDisplay: service,
    location: "Patient details NOT captured — verify never completed",
    context: `Captured ₹${amountRupees} with NO booking (order ${args.orderId}). Reconcile in ops. Contact: ${phone}`,
    patientMobile: phone,
  });

  return {
    action: "reconciliation_created",
    bookingId: inserted?.id as string,
    opsAlerted: alert.sent,
  };
}

export interface PaymentLeakMonitorDeps {
  supabase: SupabaseClient;
  sendOpsAlertFn?: typeof sendOpsAlert;
  now?: Date;
}

export interface PaymentLeakMonitorResult {
  ran: true;
  stuckReconcileCount: number;
  pipelineSilent: boolean;
  alertsSent: number;
}

/**
 * Periodic dead-man's switch (pg_cron, ~every 30 min). Two signals:
 *   1. Un-reconciled webhook stubs older than 15 min — the orphan wasn't
 *      cleared by a late verify or by ops. Re-alert so it isn't forgotten.
 *   2. Pipeline silence — zero captured bookings in the last 24h *after* the
 *      pipeline was active in the prior 24-48h. That "was busy, now silent"
 *      shape is the original P0 symptom (bookings stopped recording); a plain
 *      quiet startup won't trip it.
 */
export async function runPaymentLeakMonitor(
  deps: PaymentLeakMonitorDeps,
): Promise<PaymentLeakMonitorResult> {
  const { supabase } = deps;
  const sendOpsAlertFn = deps.sendOpsAlertFn ?? sendOpsAlert;
  const now = deps.now ?? new Date();
  const iso = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();
  const H = 3600_000;

  let alertsSent = 0;

  // --- 1. Stuck reconciliation stubs (>15 min, still PENDING). ---
  const { data: stuck } = await supabase
    .from("bookings")
    .select("id, booking_code, razorpay_order_id, amount, payment_captured_at")
    .eq("status", "PENDING")
    .like("ops_notes", `${WEBHOOK_RECONCILE_MARKER}%`)
    .lte("payment_captured_at", iso(15 * 60_000));
  const stuckRows = stuck ?? [];

  if (stuckRows.length > 0) {
    const totalRupees = stuckRows.reduce(
      (sum, r) => sum + (Number(r.amount) || 0),
      0,
    );
    const orders = stuckRows
      .map((r) => r.razorpay_order_id)
      .filter(Boolean)
      .join(", ");
    const res = await sendOpsAlertFn({
      conversationId: null,
      escalationId: null,
      patientName: "⚠ ORPHAN PAYMENTS UNRECONCILED",
      patientAge: "—",
      serviceDisplay: `${stuckRows.length} captured payment(s)`,
      location: "Reconcile in ops dashboard",
      context: `${stuckRows.length} captured payment(s) totalling ₹${totalRupees} still have no real booking after 15 min. Orders: ${orders}`,
      patientMobile: "unknown",
    });
    if (res.sent) alertsSent++;
  }

  // --- 2. Pipeline-silence dead-man's switch. ---
  const { count: last24 } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("payment_status", "CAPTURED")
    .gte("payment_captured_at", iso(24 * H));
  const { count: prev24to48 } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("payment_status", "CAPTURED")
    .gte("payment_captured_at", iso(48 * H))
    .lt("payment_captured_at", iso(24 * H));

  const pipelineSilent = (last24 ?? 0) === 0 && (prev24to48 ?? 0) > 0;
  if (pipelineSilent) {
    const res = await sendOpsAlertFn({
      conversationId: null,
      escalationId: null,
      patientName: "⚠ BOOKINGS PIPELINE SILENT",
      patientAge: "—",
      serviceDisplay: "0 captured bookings in 24h",
      location: "Check Razorpay + /api/razorpay/verify + env",
      context: `Zero captured bookings in the last 24h, but ${prev24to48} in the prior 24h. The booking/payment pipeline may be down — investigate immediately.`,
      patientMobile: "unknown",
    });
    if (res.sent) alertsSent++;
  }

  return {
    ran: true,
    stuckReconcileCount: stuckRows.length,
    pipelineSilent,
    alertsSent,
  };
}

// ---------------------------------------------------------------------------
// persistBookingIdempotent — the "capture → booking" write, made atomic +
// idempotent + LOUD. Used by /api/razorpay/verify so a proven-paid booking can
// never yield a silent no-booking:
//   - insert keyed by razorpay_order_id;
//   - a 23505 unique violation upgrades the existing row in place (webhook
//     reconciliation stub, double-submit) and reports wasNewlyInserted=false so
//     the caller doesn't double-fire confirmations;
//   - ANY genuine write failure fires the hardened ops alert BEFORE returning,
//     so money-in-no-booking is impossible to miss.
// ---------------------------------------------------------------------------

export interface PersistBookingResult {
  ok: boolean;
  bookingId?: string;
  bookingCode?: string | null;
  /** false on the 23505 upgrade path — caller must not re-fire confirmations. */
  wasNewlyInserted: boolean;
  error?: unknown;
}

export interface PersistBookingDeps {
  supabase: SupabaseClient;
  sendOpsAlertFn?: typeof sendOpsAlert;
}

export async function persistBookingIdempotent(
  insertPayload: Record<string, unknown>,
  orderId: string,
  deps: PersistBookingDeps,
): Promise<PersistBookingResult> {
  const { supabase } = deps;
  const sendOpsAlertFn = deps.sendOpsAlertFn ?? sendOpsAlert;

  const inserted = await supabase
    .from("bookings")
    .insert(insertPayload)
    .select("id, booking_code")
    .single();
  let data = inserted.data as { id?: string; booking_code?: string | null } | null;
  let error = inserted.error as { code?: string; message?: string } | null;
  let wasNewlyInserted = !error;

  if (error && error.code === PG_UNIQUE_VIOLATION) {
    // A booking already exists for this order (webhook stub or double-submit).
    // Upgrade it in place with the real details captured here.
    const upgraded = await supabase
      .from("bookings")
      .update(insertPayload)
      .eq("razorpay_order_id", orderId)
      .select("id, booking_code")
      .single();
    data = upgraded.data as { id?: string; booking_code?: string | null } | null;
    error = upgraded.error as { code?: string; message?: string } | null;
    wasNewlyInserted = false;
    if (!error) {
      console.info(
        "[persistBookingIdempotent] order already had a booking — upgraded in place",
        orderId,
      );
    }
  }

  if (error) {
    const amountPaise =
      typeof insertPayload.booking_fee_paid_paise === "number"
        ? insertPayload.booking_fee_paid_paise
        : 0;
    const amountRupees = Math.round(Number(amountPaise)) / 100;
    await sendOpsAlertFn({
      conversationId: null,
      escalationId: null,
      patientName: "⚠ PAID — BOOKING SAVE FAILED",
      patientAge: "—",
      serviceDisplay: String(insertPayload.service_category ?? "unknown"),
      location: "DB write failed after capture — reconcile now",
      context: `Captured payment ${String(
        insertPayload.razorpay_payment_id ?? "?",
      )} (order ${orderId}, ₹${amountRupees}) but booking write FAILED: ${
        error.message ?? "unknown"
      }. Money in, NO booking.`,
      patientMobile: String(insertPayload.phone ?? "unknown"),
    });
    return { ok: false, wasNewlyInserted: false, error };
  }

  return {
    ok: true,
    bookingId: data?.id,
    bookingCode: data?.booking_code ?? null,
    wasNewlyInserted,
  };
}

// ---------------------------------------------------------------------------
// reconcileRazorpayOrphans — the ACTIVE backstop. The webhook safety net only
// fires if Razorpay is configured to call it (in prod it produced 0 stubs over
// 2 months — never wired), and runPaymentLeakMonitor only watches existing
// stubs + pipeline silence. Neither notices a captured payment that simply
// never became a booking. This polls Razorpay directly for recently-captured
// payments and ensures each has a booking (creating a reconciliation stub +
// ops alert for any orphan), so a leak is caught within one cron interval even
// if the webhook is silent. Idempotent: re-runs over the same window are no-ops
// once a booking/stub exists.
// ---------------------------------------------------------------------------

/** Minimal shape of a Razorpay payment entity we depend on. */
export interface RazorpayPaymentLite {
  id: string;
  order_id: string | null;
  status: string;
  /** paise */
  amount: number;
  contact?: string | null;
  email?: string | null;
  /** payment.notes (copied from the order) — used to skip the report-fee lane. */
  notes?: Record<string, string> | null;
}

export interface ReconcileOrphansDeps {
  supabase: SupabaseClient;
  /** Lists Razorpay payments captured in [fromUnix, toUnix]. Injected so tests
   *  never hit Razorpay; the cron route wraps razorpay.payments.all(). */
  listPayments: (fromUnix: number, toUnix: number) => Promise<RazorpayPaymentLite[]>;
  fetchOrderNotes: (orderId: string) => Promise<Record<string, string>>;
  sendOpsAlertFn?: typeof sendOpsAlert;
  now?: Date;
}

export interface ReconcileOrphansResult {
  ran: true;
  windowFromUnix: number;
  windowToUnix: number;
  scanned: number;
  /** orphans that had no booking and got a reconciliation stub + alert. */
  orphansEnsured: number;
  /** captured payments that already had a booking. */
  alreadyPresent: number;
  /** report-fee captures skipped (they belong to the report lane, not orphans). */
  skippedReportLane: number;
  errors: number;
}

export async function reconcileRazorpayOrphans(
  deps: ReconcileOrphansDeps,
  opts?: { lookbackMs?: number },
): Promise<ReconcileOrphansResult> {
  const now = deps.now ?? new Date();
  // Default 6h window, run more often than that so consecutive runs overlap and
  // nothing slips between them. Kept short so a first deploy does NOT re-alert
  // the historical backlog (those are handled by an explicit data backfill).
  const lookbackMs = opts?.lookbackMs ?? 6 * 3600_000;
  const toUnix = Math.floor(now.getTime() / 1000);
  const fromUnix = Math.floor((now.getTime() - lookbackMs) / 1000);

  const payments = await deps.listPayments(fromUnix, toUnix);

  let scanned = 0;
  let orphansEnsured = 0;
  let alreadyPresent = 0;
  let errors = 0;
  let skippedReportLane = 0;

  for (const p of payments) {
    if (p.status !== "captured" || !p.order_id) continue;
    // Report-fee captures live on report_razorpay_order_id (the webhook's
    // lab_report_payment branch owns them) — never a booking-fee orphan, so
    // skip them or we'd stub a phantom booking + false-alert.
    if (p.notes?.flow === REPORT_PAYMENT_FLOW) {
      skippedReportLane++;
      continue;
    }
    scanned++;
    try {
      const res = await ensureBookingForCapturedOrder(
        {
          orderId: p.order_id,
          paymentId: p.id,
          amountPaise: Number(p.amount) || 0,
          contact: p.contact ?? null,
          email: p.email ?? null,
        },
        {
          supabase: deps.supabase,
          fetchOrderNotes: deps.fetchOrderNotes,
          sendOpsAlertFn: deps.sendOpsAlertFn,
          now,
        },
      );
      if (res.action === "reconciliation_created") orphansEnsured++;
      else alreadyPresent++;
    } catch (e) {
      errors++;
      console.error(
        "[reconcileRazorpayOrphans] ensure failed for order",
        p.order_id,
        e,
      );
    }
  }

  return {
    ran: true,
    windowFromUnix: fromUnix,
    windowToUnix: toUnix,
    scanned,
    orphansEnsured,
    alreadyPresent,
    skippedReportLane,
    errors,
  };
}

// ---------------------------------------------------------------------------
// alertOnPostCaptureFailure — the LOUD path for a post-capture failure that is
// NOT a DB write failure (persistBookingIdempotent already alerts on those):
// an order-fetch failure, a cart/amount integrity mismatch, or an auth failure
// after a valid signature. Once the Razorpay signature verifies, the money is
// captured — so no such branch may exit on a bare console.error. This is the
// single shared "money in, something went wrong" alert used by the web + app
// verify routes so ops can reconcile or refund. Never throws.
// ---------------------------------------------------------------------------

export interface PostCaptureFailureArgs {
  orderId: string;
  paymentId: string;
  /** paise captured (order.amount) if known. */
  amountPaise?: number | null;
  /** patient phone / Razorpay contact if known. */
  contact?: string | null;
  /** human service label, e.g. "Medic at Home". */
  serviceDisplay?: string;
  /** short reason, e.g. "cart/amount integrity mismatch" or "order fetch failed". */
  reason: string;
}

export async function alertOnPostCaptureFailure(
  args: PostCaptureFailureArgs,
  deps: { sendOpsAlertFn?: typeof sendOpsAlert } = {},
): Promise<void> {
  const sendOpsAlertFn = deps.sendOpsAlertFn ?? sendOpsAlert;
  const rupees =
    args.amountPaise != null ? Math.round(Number(args.amountPaise)) / 100 : null;
  try {
    await sendOpsAlertFn({
      conversationId: null,
      escalationId: null,
      patientName: "⚠ PAID — POST-CAPTURE FAILURE",
      patientAge: "—",
      serviceDisplay: args.serviceDisplay ?? "unknown",
      location: "Money captured; booking not completed — reconcile / refund now",
      context: `${args.reason} · order ${args.orderId}, payment ${args.paymentId}${
        rupees != null ? `, ₹${rupees}` : ""
      }. Contact: ${args.contact ?? "unknown"}.`,
      patientMobile: args.contact ?? "unknown",
    });
  } catch (e) {
    // The hardened sendOpsAlert never throws; this is belt-and-braces so a
    // post-capture failure path can never turn its own alert into an exception.
    console.error("[alertOnPostCaptureFailure] alert send threw (swallowed)", e);
  }
}
