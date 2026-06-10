// T85 PR4b v2 — standardized `aarogya_lead_alert` {{5}} Context format.
//
// Single source of truth for the payment-status string embedded inside
// the Rampwin lead-alert template's free-text variable. Ops sees a
// consistent structured payload across all 4 services:
//
//   {{5}} = `{notes or "—"} | Paid ₹{X} of ₹{total} ({mode_description})`
//
// Modes:
//   - 'partial-advance-50' — non-lab services (Home-Visit, Teleconsult,
//                            Medic at Home). Patient pays 50% rounded up;
//                            balance auto-charged at case close.
//   - 'lab-full'           — lab Mode A. Patient pays full grand total
//                            at booking; nothing owed at door.
//   - 'lab-partial'        — lab Mode B. Patient pays ₹200 collection
//                            fee at booking; balance owed at the door
//                            via UPI.
//
// Why this lives in shared infra: the Meta WhatsApp Manager template +
// the Rampwin BSP catalog both have `{{5}}` registered as free-text.
// Embedding the structured payload inside it means we never need to
// re-submit the template for approval to change the payment-status
// display — just edit this file and redeploy. Founder decision
// 2026-06-08 v2.

export interface PaymentSummary {
  /** Amount actually captured in this transaction (paise). */
  paidPaise: number;
  /** Total billable amount for the case (paise). */
  totalPaise: number;
  mode: "partial-advance-50" | "lab-full" | "lab-partial";
}

/**
 * Build the `{{5}}` Context string. Accepts an optional `notes` field
 * (patient-supplied notes / symptoms; default "—" if empty) and a
 * `payment` summary. Returns the formatted single-line string the
 * Rampwin sender embeds into the template.
 *
 * Pure function — easy to unit-test (and easy for ops to mentally
 * parse the format spec when reading the source).
 */
export function formatLeadAlertContext(
  notes: string | null | undefined,
  payment: PaymentSummary,
): string {
  const left = notes?.trim() || "—";
  const paidInr = Math.round(payment.paidPaise / 100);
  const totalInr = Math.round(payment.totalPaise / 100);
  const balanceInr = Math.max(0, totalInr - paidInr);

  let modeDesc: string;
  switch (payment.mode) {
    case "partial-advance-50":
      modeDesc = "50% advance, balance at case close";
      break;
    case "lab-full":
      modeDesc = "full prepaid";
      break;
    case "lab-partial":
      modeDesc = `₹${balanceInr} at door via UPI`;
      break;
  }

  return `${left} | Paid ₹${paidInr} of ₹${totalInr} (${modeDesc})`;
}
