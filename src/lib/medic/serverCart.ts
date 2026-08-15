import "server-only";

import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  computeCartQuote,
  type CartItemInput,
  type CartQuote,
  type ProcedureRow,
} from "./cartPricing";

// Server-side cart loading + integrity helpers for the PB5 medic cart.
// The pricing engine (cartPricing.ts) is pure; this module is the DB seam that
// feeds it authoritative rows and binds a cart to a Razorpay order so /verify
// can never be tricked into snapshotting a cart the customer didn't pay for.

/** Flat ₹100 booking-confirmation fee — the "pay ₹100 to confirm" option. Flat
 *  regardless of cart size; the rest of the prepay + any at-visit variable is
 *  collected at/after the visit. Always < prepay (base visit alone is ₹199). */
export const MEDIC_BOOKING_FEE_PAISE = 10_000;

export type MedicPaymentMode = "booking_fee" | "full";

/** Parse an untrusted payment_mode; defaults to "full" (back-compat). */
export function normalizePaymentMode(raw: unknown): MedicPaymentMode {
  return raw === "booking_fee" ? "booking_fee" : "full";
}

export interface CatalogRow extends ProcedureRow {
  rx_required: string | null;
}

export interface LoadedCartQuote {
  quote: CartQuote;
  rows: CatalogRow[];
  /** Codes needing an Rx before checkout (UI gate lives in Phase B). */
  rxYes: string[];
  rxCaseByCase: string[];
}

const CATALOG_COLS =
  "code, name, tier, rx_required, is_base_included, absolute_price_paise, delta_paise, price_type, per_unit_addon_paise, hourly_addon_paise";

/**
 * Load the matching active catalog rows and compute the server-authoritative
 * quote. Unknown/inactive codes simply don't price (computeCartQuote ignores
 * codes it can't find).
 */
export async function loadAndQuoteCart(
  supabase: SupabaseClient,
  items: CartItemInput[],
): Promise<LoadedCartQuote> {
  const codes = Array.from(
    new Set((items ?? []).map((i) => i?.code).filter((c): c is string => Boolean(c))),
  );
  if (codes.length === 0) {
    return { quote: computeCartQuote([], []), rows: [], rxYes: [], rxCaseByCase: [] };
  }

  const { data, error } = await supabase
    .from("home_care_procedures")
    .select(CATALOG_COLS)
    .in("code", codes)
    .eq("is_active", true);

  if (error) throw new Error(`home_care_procedures load failed: ${error.message}`);

  const rows = (data ?? []) as CatalogRow[];
  const quote = computeCartQuote(items, rows);
  return {
    quote,
    rows,
    rxYes: rows.filter((r) => r.rx_required === "yes").map((r) => r.code),
    rxCaseByCase: rows.filter((r) => r.rx_required === "case_by_case").map((r) => r.code),
  };
}

/**
 * Sanitise an untrusted request body into cart items. Drops malformed rows,
 * coerces qty/units/hours to bounded positive integers, caps the cart size.
 */
export function normalizeCartItems(raw: unknown): CartItemInput[] {
  if (!Array.isArray(raw)) return [];
  const out: CartItemInput[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    const code = rec.code;
    const qty = Math.trunc(Number(rec.qty));
    if (typeof code !== "string" || code.length === 0 || !Number.isFinite(qty) || qty <= 0) {
      continue;
    }
    const item: CartItemInput = { code, qty: Math.min(qty, 99) };
    const units = Math.trunc(Number(rec.units));
    const hours = Math.trunc(Number(rec.hours));
    if (Number.isFinite(units) && units > 0) item.units = Math.min(units, 999);
    if (Number.isFinite(hours) && hours > 0) item.hours = Math.min(hours, 999);
    out.push(item);
    if (out.length >= 50) break;
  }
  return out;
}

/**
 * Stable signature of a cart — sorted by code, includes qty/units/hours — so
 * the same cart always hashes identically regardless of item order.
 */
export function cartSignature(items: CartItemInput[]): string {
  return (items ?? [])
    .filter((i) => i && typeof i.code === "string" && Number(i.qty) > 0)
    .map((i) => ({
      code: i.code,
      qty: Math.trunc(Number(i.qty)),
      units: Math.trunc(Number(i.units) || 0),
      hours: Math.trunc(Number(i.hours) || 0),
    }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((i) => `${i.code}:${i.qty}:${i.units}:${i.hours}`)
    .join("|");
}

/** sha256 of the cart signature — stored in the Razorpay order notes at
 *  create-order and re-checked at verify (binds the paid cart to the order). */
export function cartHash(items: CartItemInput[]): string {
  return crypto.createHash("sha256").update(cartSignature(items)).digest("hex");
}
