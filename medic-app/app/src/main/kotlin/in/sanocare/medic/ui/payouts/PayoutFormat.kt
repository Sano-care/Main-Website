package `in`.sanocare.medic.ui.payouts

import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

// Medic payroll — presentation helpers for the Payouts tab. Mirrors the web
// `rupees()` (₹ + en-IN grouping, U+2212 minus for negatives) and the entry-type
// labels used in the ops PayoutTab. minSdk 26 ships java.time natively.

private val EN_IN: Locale = Locale.Builder().setLanguage("en").setRegion("IN").build()
private val RUPEE_GROUP: NumberFormat = NumberFormat.getNumberInstance(EN_IN).apply {
    minimumFractionDigits = 0
    maximumFractionDigits = 2
}
private val DATE_OUT: DateTimeFormatter =
    DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)

/** Signed paise → "₹1,200" / "₹1,200.50" / "−₹500" (mirrors the web rupees()). */
fun rupees(paise: Long): String {
    val sign = if (paise < 0) "−" else ""
    val abs = kotlin.math.abs(paise) / 100.0
    return "$sign₹${RUPEE_GROUP.format(abs)}"
}

/** Human label for a ledger entry_type (mirrors the ops PayoutTab map). */
fun entryTypeLabel(entryType: String): String = when (entryType) {
    "revenue_share" -> "Revenue share"
    "commission" -> "Commission"
    "daily_wage" -> "Daily wage"
    "overtime" -> "Overtime"
    "payout" -> "Payout"
    "adjustment" -> "Adjustment"
    "reversal" -> "Reversal"
    "gda_shift" -> "GDA shift"
    else -> entryType.split('_').joinToString(" ") { part ->
        part.replaceFirstChar { it.uppercase() }
    }
}

/** "YYYY-MM-DD" (IST work date) → "3 Jun 2026"; passthrough on parse failure. */
fun formatLedgerDate(date: String?): String {
    if (date.isNullOrBlank()) return ""
    return runCatching { DATE_OUT.format(LocalDate.parse(date)) }.getOrDefault(date)
}
