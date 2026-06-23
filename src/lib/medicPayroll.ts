// Medic payroll — pure helpers shared by the ops payout panel and the medic-app
// payouts endpoint. Kept side-effect-free so vitest can exercise them directly.
//
// The accrual itself lives in the SECURITY DEFINER triggers (migration
// 20260622163258_medic_payroll). These helpers only summarise the resulting
// ledger and mirror the C1 lab-exclusion rule for documentation/parity.

export interface LedgerEntryLike {
  entry_type: string;
  amount_paise: number;
}

export interface LedgerSummary {
  /** Gross earned, net of reversals (= balance + paid). */
  earnedPaise: number;
  /** Total paid out (positive number; payouts are stored negative). */
  paidPaise: number;
  /** Current balance owed to the medic = SUM(all amount_paise). */
  balancePaise: number;
}

/**
 * Summarise a medic's ledger.
 *   balance = SUM(all amount_paise)
 *   paid    = -SUM(payout amount_paise)   (payouts stored negative)
 *   earned  = balance + paid
 */
export function summarizeLedger(entries: LedgerEntryLike[]): LedgerSummary {
  let balance = 0;
  let paid = 0;
  for (const e of entries) {
    balance += e.amount_paise;
    if (e.entry_type === "payout") paid += -e.amount_paise;
  }
  return { earnedPaise: balance + paid, paidPaise: paid, balancePaise: balance };
}

// C1 — completed lab bookings yield no medic earning. The enforcement is in the
// post_medic_earnings_on_booking trigger; this mirror documents the contract and
// is unit-tested so the category list can't silently drift.
export const LAB_SERVICE_CATEGORIES = [
  "lab",
  "lab-tests",
  "diagnostics",
] as const;

export function isLabServiceCategory(
  serviceCategory: string | null | undefined,
): boolean {
  const sc = (serviceCategory ?? "").toLowerCase();
  return (LAB_SERVICE_CATEGORIES as readonly string[]).includes(sc);
}
