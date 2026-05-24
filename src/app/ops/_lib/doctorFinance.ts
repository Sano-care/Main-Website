// Helpers for computing doctor financial figures from the append-only
// ledger. The same shapes are used by /ops/doctors (list summary) and
// the detail page header.
//
// Definitions:
//   - total_earned   = gross of revenue_share | commission | daily_wage |
//                      overtime entries. Reversals are NOT subtracted here
//                      — this is a "what was posted" figure, not "what's
//                      currently owed".
//   - total_paid_out = abs(sum) of payout entries. Reversals of payouts
//                      are not netted out here either; the gross outflow
//                      is the useful display number.
//   - balance        = signed sum across EVERY entry (earnings, payouts,
//                      adjustments, reversals). This IS what the doctor
//                      is currently owed; reversals do reduce it because
//                      they cancel out the original entry's sign.
//
// Adjustments contribute only to the balance — they're escape hatches for
// manual corrections that don't fit any other category, so they don't
// belong in either headline figure.

export const EARNING_ENTRY_TYPES = [
  "revenue_share",
  "commission",
  "daily_wage",
  "overtime",
] as const;

export type LedgerEntryForFigures = {
  amount_paise: number;
  entry_type: string;
};

export function computeDoctorFigures(entries: LedgerEntryForFigures[]): {
  totalEarnedPaise: number;
  totalPaidOutPaise: number;
  balancePaise: number;
} {
  let totalEarned = 0;
  let totalPaidOut = 0;
  let balance = 0;
  for (const e of entries) {
    balance += e.amount_paise;
    if ((EARNING_ENTRY_TYPES as readonly string[]).includes(e.entry_type)) {
      totalEarned += e.amount_paise;
    } else if (e.entry_type === "payout") {
      totalPaidOut += Math.abs(e.amount_paise);
    }
  }
  return {
    totalEarnedPaise: totalEarned,
    totalPaidOutPaise: totalPaidOut,
    balancePaise: balance,
  };
}

/** Format a paise integer as "₹X,XXX" (Indian numbering). Always signed. */
export function rupees(paise: number): string {
  const sign = paise < 0 ? "−" : "";
  return `${sign}₹${Math.abs(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
