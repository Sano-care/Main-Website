// PB5a — Medic-at-Home cart pricing engine (pure + unit-tested).
//
// Money is server-authoritative: this module is the ONLY place a cart total is
// computed. The client never sends a price — it sends a list of {code, qty}
// and (optionally, at settlement) per-unit / hourly counts. Prices come from
// `home_care_procedures` rows (frozen, seeded from CSV, all in paise).
//
// Pricing model
// -------------
//   BASE_VISIT_PAISE (₹199) is charged once when the cart is non-empty.
//   Base-included procedures: the FIRST base actionable is covered by the
//     visit; each further base unit is BASE_EXTRA_UNIT_PAISE (₹100).
//   Non-base procedures, by price_type:
//     fixed          — qty × delta_paise (fully prepaid).
//     from           — qty × delta_paise starting/floor price, prepaid;
//                       is_variable, the final amount is settled at visit.
//     per_unit_addon — qty × delta_paise prepaid + per_unit_addon_paise × units
//                       (suture/staple counts entered at visit → is_variable).
//     per_drip_hourly— qty × absolute_price_paise prepaid (₹399/drip incl. the
//                       1st hour) + hourly_addon_paise × extra hours at visit.
//
//   prepay_paise  = base visit + base extras + all fixed/known/floor components.
//   at_visit_paise= the variable components that are known (units/hours passed).
//                   At quote time (no counts) these are 0 but the line is flagged
//                   is_variable so the UI shows "settled at visit".
//   total_paise   = prepay_paise + at_visit_paise.
//   Σ line_total_paise === total_paise (booking_items snapshots reconcile).

export const BASE_VISIT_PAISE = 19_900;
export const BASE_EXTRA_UNIT_PAISE = 10_000;

/** Synthetic line-item code for the ₹199 base visit (not a catalog row). */
export const BASE_VISIT_CODE = "__base_visit__";

export type PriceType = "fixed" | "from" | "per_unit_addon" | "per_drip_hourly";

/** A catalog row as loaded from `home_care_procedures` (only pricing fields). */
export interface ProcedureRow {
  code: string;
  name?: string | null;
  tier?: string | null;
  is_base_included: boolean;
  absolute_price_paise: number;
  delta_paise: number;
  price_type: PriceType | string | null;
  per_unit_addon_paise?: number | null;
  hourly_addon_paise?: number | null;
}

export interface CartItemInput {
  code: string;
  qty: number;
  /** per_unit_addon: number of sutures/staples (entered at visit). */
  units?: number;
  /** per_drip_hourly: total drip hours; the first hour is included in the drip. */
  hours?: number;
}

export interface CartLineItem {
  code: string;
  name: string | null;
  tier: string | null;
  qty: number;
  unit_price_paise: number;
  line_total_paise: number;
  is_variable: boolean;
  meta?: Record<string, unknown>;
}

export interface CartQuote {
  total_paise: number;
  prepay_paise: number;
  at_visit_paise: number;
  line_items: CartLineItem[];
}

function posInt(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : 0;
}

/**
 * Compute the server-authoritative quote for a cart.
 *
 * @param items rows the client wants (code + qty, optional units/hours)
 * @param catalog the matching `home_care_procedures` rows (order irrelevant)
 */
export function computeCartQuote(
  items: CartItemInput[],
  catalog: ProcedureRow[],
): CartQuote {
  const byCode = new Map<string, ProcedureRow>();
  for (const r of catalog) byCode.set(r.code, r);

  // Only rows that exist in the catalog and have a positive integer qty count.
  const valid = (items ?? []).filter(
    (it) => it && byCode.has(it.code) && posInt(it.qty) > 0,
  );

  const lineItems: CartLineItem[] = [];
  if (valid.length === 0) {
    return { total_paise: 0, prepay_paise: 0, at_visit_paise: 0, line_items: [] };
  }

  let prepay = 0;
  let atVisit = 0;

  // ₹199 base visit — charged once for a non-empty cart.
  prepay += BASE_VISIT_PAISE;
  lineItems.push({
    code: BASE_VISIT_CODE,
    name: "Home visit (base)",
    tier: "base",
    qty: 1,
    unit_price_paise: BASE_VISIT_PAISE,
    line_total_paise: BASE_VISIT_PAISE,
    is_variable: false,
  });

  let baseFreeUsed = false;

  for (const it of valid) {
    const row = byCode.get(it.code)!;
    const qty = posInt(it.qty);

    // Base-included: first actionable across the whole cart is free, rest ₹100.
    if (row.is_base_included) {
      let chargeableUnits = qty;
      let firstFree = false;
      if (!baseFreeUsed) {
        chargeableUnits = Math.max(0, qty - 1);
        baseFreeUsed = true;
        firstFree = true;
      }
      const lineTotal = chargeableUnits * BASE_EXTRA_UNIT_PAISE;
      prepay += lineTotal;
      lineItems.push({
        code: row.code,
        name: row.name ?? null,
        tier: row.tier ?? null,
        qty,
        unit_price_paise: BASE_EXTRA_UNIT_PAISE,
        line_total_paise: lineTotal,
        is_variable: false,
        meta: { base_included: true, first_free: firstFree },
      });
      continue;
    }

    const base = {
      code: row.code,
      name: row.name ?? null,
      tier: row.tier ?? null,
      qty,
    };

    switch (row.price_type) {
      case "from": {
        const floor = qty * row.delta_paise;
        prepay += floor;
        lineItems.push({
          ...base,
          unit_price_paise: row.delta_paise,
          line_total_paise: floor,
          is_variable: true,
          meta: { price_type: "from", note: "starting price; final settled at visit" },
        });
        break;
      }
      case "per_unit_addon": {
        const basePortion = qty * row.delta_paise;
        const units = posInt(it.units);
        const addon = units * (row.per_unit_addon_paise ?? 0);
        prepay += basePortion;
        atVisit += addon;
        lineItems.push({
          ...base,
          unit_price_paise: row.delta_paise,
          line_total_paise: basePortion + addon,
          is_variable: true,
          meta: {
            price_type: "per_unit_addon",
            per_unit_addon_paise: row.per_unit_addon_paise ?? 0,
            units: units || null,
          },
        });
        break;
      }
      case "per_drip_hourly": {
        const dripPortion = qty * row.absolute_price_paise;
        const hours = posInt(it.hours);
        const extraHours = hours > 0 ? Math.max(0, hours - 1) : 0;
        const hourly = extraHours * (row.hourly_addon_paise ?? 0);
        prepay += dripPortion;
        atVisit += hourly;
        lineItems.push({
          ...base,
          unit_price_paise: row.absolute_price_paise,
          line_total_paise: dripPortion + hourly,
          is_variable: true,
          meta: {
            price_type: "per_drip_hourly",
            hourly_addon_paise: row.hourly_addon_paise ?? 0,
            hours: hours || null,
          },
        });
        break;
      }
      case "fixed":
      default: {
        const line = qty * row.delta_paise;
        prepay += line;
        lineItems.push({
          ...base,
          unit_price_paise: row.delta_paise,
          line_total_paise: line,
          is_variable: false,
        });
        break;
      }
    }
  }

  return {
    total_paise: prepay + atVisit,
    prepay_paise: prepay,
    at_visit_paise: atVisit,
    line_items: lineItems,
  };
}
