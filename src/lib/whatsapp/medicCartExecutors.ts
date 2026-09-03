// Aarogya — Medic-at-Home cart tools (search + quote + start-booking).
//
// One pricing engine, three surfaces: these executors CALL the shared engine
// (src/lib/medic/serverCart.ts → cartPricing.ts, reading home_care_procedures);
// they never re-implement pricing and never trust a client/agent-supplied price.
// The LLM supplies intent only — which procedures (codes) + qty. Everything
// money-related (amount, the payment link, the booking) is server-authoritative.
//
// Rx routing (§5.4): any procedure with rx_required = 'yes' → Aarogya QUOTES it
// but must NOT self-book. start-booking routes the whole cart to ops for Rx
// verification instead of sending a payment link. 'case_by_case' + 'no' (base/
// standard) self-serve to a Razorpay payment link.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Identity } from "@/lib/whatsapp/identity";
import { log } from "@/lib/whatsapp/log";
import { sendOpsAlert } from "@/lib/whatsapp/opsAlert";
import { getRazorpayClient } from "@/lib/razorpay";
import {
  loadAndQuoteCart,
  normalizeCartItems,
  cartHash,
  normalizePaymentMode,
  MEDIC_BOOKING_FEE_PAISE,
  type CatalogRow,
  type LoadedCartQuote,
} from "@/lib/medic/serverCart";
import { BASE_VISIT_CODE } from "@/lib/medic/cartPricing";
import { createCartIntent, attachLinkToIntent } from "@/lib/medic/cartIntent";

function isPatient(identity: Identity): boolean {
  return identity.role === "customer" || identity.role === "new";
}

const rupees = (paise: number): string =>
  `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

// ── search ──────────────────────────────────────────────────────────────────

/** A catalog row plus the fields the search formatter shows. */
export interface MedicSearchRow extends CatalogRow {
  name: string | null;
  category?: string | null;
  description?: string | null;
}

const SEARCH_COLS =
  "code, name, category, tier, rx_required, is_base_included, absolute_price_paise, delta_paise, price_type, per_unit_addon_paise, hourly_addon_paise, description, display_order";

/** Live fuzzy search over the active catalog by name/category. */
export async function searchMedicProcedures(
  supabase: SupabaseClient,
  query: string,
  limit = 6,
): Promise<MedicSearchRow[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const pattern = `%${q.replace(/[%_]/g, "")}%`;
  const { data, error } = await supabase
    .from("home_care_procedures")
    .select(SEARCH_COLS)
    .eq("is_active", true)
    .or(`name.ilike.${pattern},category.ilike.${pattern}`)
    .order("display_order", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`medic procedure search failed: ${error.message}`);
  return (data ?? []) as MedicSearchRow[];
}

/** One-line "starting/price" hint for a catalog row (never the cart total). */
export function priceHint(row: MedicSearchRow): string {
  if (row.is_base_included) {
    return "included in the ₹199 visit (₹100 each beyond the first)";
  }
  switch (row.price_type) {
    case "from":
      return `from ${rupees(row.delta_paise)} (final settled at visit)`;
    case "per_unit_addon":
      return `${rupees(row.delta_paise)} + ${rupees(
        row.per_unit_addon_paise ?? 0,
      )}/unit at visit`;
    case "per_drip_hourly":
      return `${rupees(row.absolute_price_paise)} + ${rupees(
        row.hourly_addon_paise ?? 0,
      )}/hr after the 1st hour`;
    case "fixed":
    default:
      return `${rupees(row.delta_paise)}`;
  }
}

const NO_MATCH =
  "I couldn't find that procedure — try a name like \"IV drip\", \"wound dressing\", \"injection\", or \"catheter care\", and I'll pull it up.";

export function formatProcedureResults(rows: MedicSearchRow[], query: string): string {
  if (rows.length === 0) return NO_MATCH;
  const lines = rows.map((r) => {
    const bits = [priceHint(r)];
    if (r.rx_required === "yes") bits.push("needs a doctor's prescription");
    return `• ${r.name ?? r.code} — ${bits.join(" · ")}`;
  });
  return (
    `Here's what I found for "${query}" (every visit includes the ₹199 base):\n` +
    `${lines.join("\n")}\n\n` +
    "Tell me which ones (and how many) and I'll give you the exact total."
  );
}

export interface SearchMedicDeps {
  supabase: SupabaseClient;
  search?: typeof searchMedicProcedures;
}

export async function executeSearchMedicProcedures(
  args: { identity: Identity; input: { query?: string } },
  deps: SearchMedicDeps,
): Promise<string> {
  if (!isPatient(args.identity)) return "That's not something I can look up here.";
  const query = (args.input.query ?? "").trim();
  if (query.length < 2) {
    return "Which procedure would you like? e.g. IV drip, wound dressing, an injection.";
  }
  const search = deps.search ?? searchMedicProcedures;
  try {
    const rows = await search(deps.supabase, query, 6);
    return formatProcedureResults(rows, query);
  } catch (err) {
    log.error("executeSearchMedicProcedures failed", err);
    return "I couldn't pull that up just now — tell me the procedure name and I'll try again.";
  }
}

// ── quote (read-only) ─────────────────────────────────────────────────────────

/** Plain-language quote from a server-computed cart. Pure. */
export function formatQuote(loaded: LoadedCartQuote): string {
  const { quote, rxYes } = loaded;
  if (quote.prepay_paise <= 0) {
    return "I couldn't price those — send the procedure names again and I'll re-check.";
  }
  const lines = quote.line_items.map((l) => {
    if (l.code === BASE_VISIT_CODE) return `• Home visit (base) — ${rupees(l.line_total_paise)}`;
    const suffix = l.is_variable ? " · part settled at the visit" : "";
    return `• ${l.name ?? l.code} ×${l.qty} — ${rupees(l.line_total_paise)}${suffix}`;
  });
  const parts = [
    "Here's your Medic-at-Home estimate:",
    lines.join("\n"),
    "",
    `Pay now to confirm: *${rupees(quote.prepay_paise)}*.`,
  ];
  if (quote.at_visit_paise > 0) {
    parts.push(
      `Plus about ${rupees(quote.at_visit_paise)} of variable items (extra drip hours / per-unit counts) settled with the medic at the visit.`,
    );
  }
  if (rxYes.length > 0) {
    parts.push(
      "\nNote: one or more of these need a doctor's prescription — our team verifies that before we confirm the booking.",
    );
  }
  parts.push("\nWant me to send a secure payment link?");
  return parts.join("\n");
}

export interface QuoteMedicDeps {
  supabase: SupabaseClient;
  loadAndQuoteCartFn?: typeof loadAndQuoteCart;
}

export async function executeQuoteMedicCart(
  args: { identity: Identity; input: { items?: unknown } },
  deps: QuoteMedicDeps,
): Promise<string> {
  if (!isPatient(args.identity)) return "That's not something I can do here.";
  const items = normalizeCartItems(args.input.items);
  if (items.length === 0) {
    return "Tell me which procedures (by name) and how many, and I'll price it exactly.";
  }
  const load = deps.loadAndQuoteCartFn ?? loadAndQuoteCart;
  try {
    const loaded = await load(deps.supabase, items);
    return formatQuote(loaded);
  } catch (err) {
    log.error("executeQuoteMedicCart failed", err);
    return "I couldn't price that just now — send the procedure names again and I'll retry.";
  }
}

// ── start booking (Rx gate → payment link, else route to ops) ─────────────────

export interface StartMedicBookingCtx {
  identity: Identity;
  /** Conversation phone (adapter-injected; never from the model). E.164. */
  phone: string;
  conversationId: string | null;
  /** Resolved customer id for this phone, if any. */
  customerId: string | null;
}

export interface CreatedPaymentLink {
  id: string;
  short_url: string;
}

export interface StartMedicBookingDeps {
  supabase: SupabaseClient;
  loadAndQuoteCartFn?: typeof loadAndQuoteCart;
  createPaymentLink?: (args: {
    amountPaise: number;
    description: string;
    contact: string;
    name: string | null;
    notes: Record<string, string>;
  }) => Promise<CreatedPaymentLink>;
  sendOpsAlertFn?: typeof sendOpsAlert;
}

/** Default Razorpay payment-link creator. Fixed amount; we notify via WhatsApp. */
async function defaultCreatePaymentLink(args: {
  amountPaise: number;
  description: string;
  contact: string;
  name: string | null;
  notes: Record<string, string>;
}): Promise<CreatedPaymentLink> {
  const razorpay = getRazorpayClient();
  const link = await razorpay.paymentLink.create({
    amount: args.amountPaise,
    currency: "INR",
    accept_partial: false,
    description: args.description.slice(0, 250),
    customer: {
      contact: args.contact,
      ...(args.name ? { name: args.name.slice(0, 60) } : {}),
    },
    notify: { sms: false, email: false }, // Aarogya sends the link over WhatsApp
    reminder_enable: false,
    notes: args.notes,
  });
  return { id: String(link.id), short_url: String(link.short_url) };
}

/**
 * Turn a confirmed cart into a payment link (self-serve) OR route it to ops (Rx
 * required). Returns the WhatsApp reply string; the adapter sends it. Side
 * effects: writes a medic_cart_intents row + creates a Razorpay payment link,
 * or fires an ops alert. Never creates a booking here — that happens ONLY on
 * the verified payment_link.paid webhook (§5.3).
 */
export async function executeStartMedicBooking(
  args: { input: { items?: unknown; payment_mode?: unknown } },
  ctx: StartMedicBookingCtx,
  deps: StartMedicBookingDeps,
): Promise<string> {
  if (!isPatient(ctx.identity)) return "That's not something I can do here.";

  const items = normalizeCartItems(args.input.items);
  if (items.length === 0) {
    return "I need to know which procedures first — tell me the names and quantities.";
  }

  const load = deps.loadAndQuoteCartFn ?? loadAndQuoteCart;
  let loaded: LoadedCartQuote;
  try {
    loaded = await load(deps.supabase, items);
  } catch (err) {
    log.error("executeStartMedicBooking price failed", err);
    return "I couldn't price that just now — let's try again in a moment.";
  }
  const { quote, rxYes } = loaded;
  if (quote.prepay_paise <= 0) {
    return "Those items aren't available to book right now — want me to set up a regular home visit instead?";
  }

  const sendOpsAlertFn = deps.sendOpsAlertFn ?? sendOpsAlert;
  const summary = quote.line_items
    .filter((l) => l.code !== BASE_VISIT_CODE)
    .map((l) => `${l.name ?? l.code}×${l.qty}`)
    .join(", ");

  // ── Rx gate: any rx_required='yes' → NO self-book. Route to ops (§5.4). ──
  if (rxYes.length > 0) {
    await sendOpsAlertFn({
      conversationId: ctx.conversationId,
      escalationId: null,
      patientName: "Rx-verify (medic cart)",
      patientAge: "—",
      serviceDisplay: "Medic at Home (Rx required)",
      location: "Verify prescription, then confirm + collect payment",
      context: `Rx-required medic cart — DO NOT auto-book. Items: ${summary || "base visit"} · needs Rx: ${rxYes.join(", ")} · est ${rupees(
        quote.prepay_paise,
      )} prepay. Patient asked to book over WhatsApp.`,
      patientMobile: ctx.phone,
    });
    return (
      "A couple of those need a doctor's prescription before we can carry them out. " +
      "I've passed this to our care team — they'll verify the prescription and confirm your booking with you shortly. " +
      "You don't need to pay anything yet."
    );
  }

  // ── Self-serve: server-price → intent → Razorpay payment link ──
  const paymentMode = normalizePaymentMode(args.input.payment_mode);
  const chargePaise =
    paymentMode === "booking_fee" && quote.prepay_paise > MEDIC_BOOKING_FEE_PAISE
      ? MEDIC_BOOKING_FEE_PAISE
      : quote.prepay_paise;

  // Resolve the patient name for the link (best-effort; contact is enough).
  let patientName: string | null = null;
  if (ctx.customerId) {
    const { data: cust } = await deps.supabase
      .from("customers")
      .select("full_name")
      .eq("id", ctx.customerId)
      .maybeSingle();
    patientName = (cust as { full_name?: string | null } | null)?.full_name ?? null;
  }

  const intent = await createCartIntent(deps.supabase, {
    conversationId: ctx.conversationId,
    customerId: ctx.customerId,
    phone: ctx.phone,
    items,
    paymentMode,
    chargePaise,
    quote,
  });
  if ("error" in intent) {
    log.error("executeStartMedicBooking intent failed", intent.error);
    return "I hit a snag setting up the payment — give me a moment and ask me to try again.";
  }

  const createLink = deps.createPaymentLink ?? defaultCreatePaymentLink;
  let link: CreatedPaymentLink;
  try {
    link = await createLink({
      amountPaise: chargePaise,
      description: `Sanocare Medic-at-Home — ${summary || "home visit"}`,
      contact: ctx.phone,
      name: patientName,
      notes: {
        flow: "aarogya_medic_cart",
        cart_ref: intent.cartRef,
        customer_id: ctx.customerId ?? "",
        cart_hash: cartHash(items),
        charge_paise: String(chargePaise),
        payment_mode: paymentMode,
      },
    });
  } catch (err) {
    log.error("executeStartMedicBooking link create failed", err);
    return "I couldn't generate the payment link just now — please try again in a moment.";
  }

  await attachLinkToIntent(deps.supabase, intent.cartRef, link.id);

  const balancePaise = Math.max(0, quote.prepay_paise - chargePaise);
  const modeLine =
    paymentMode === "booking_fee"
      ? `This ${rupees(chargePaise)} confirms the visit; the balance ${rupees(
          balancePaise,
        )} is collected at/after the visit.`
      : quote.at_visit_paise > 0
        ? `Any variable extras (extra drip hours / per-unit counts) are settled with the medic at the visit.`
        : "";
  return (
    `Here's your secure payment link for *${rupees(chargePaise)}* (${summary || "home visit"}):\n` +
    `${link.short_url}\n\n` +
    (modeLine ? `${modeLine}\n\n` : "") +
    "Tap to pay — I'll confirm your Medic-at-Home booking the moment the payment clears. " +
    "I can only confirm once it's actually gone through on our end."
  );
}
