package `in`.sanocare.pulse.ui.records

import androidx.compose.ui.graphics.Color
import java.text.NumberFormat
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

// PB2 — pure display helpers for the Records surface. Money in ₹ (Indian
// grouping), dates in IST, human service labels, and neutral status pills
// (lifecycle colour, never a clinical judgement).

private val IST: ZoneId = ZoneId.of("Asia/Kolkata")
private val DAY_FMT: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)

fun formatInr(paise: Long): String {
    val nf = NumberFormat.getCurrencyInstance(Locale("en", "IN"))
    nf.maximumFractionDigits = 2
    return nf.format(paise / 100.0)
}

private fun parseFlexible(iso: String): ZonedDateTime = when {
    iso.length <= 10 -> LocalDate.parse(iso).atStartOfDay(IST)
    else -> runCatching { Instant.parse(iso).atZone(IST) }
        .getOrElse { OffsetDateTime.parse(iso).toZonedDateTime() }
}

/** UTC/ISO or YMD → "12 Jun 2026" in IST; null/invalid → "—". */
fun formatDay(iso: String?): String {
    if (iso.isNullOrBlank()) return "—"
    return runCatching { DAY_FMT.format(parseFlexible(iso).withZoneSameInstant(IST)) }
        .getOrDefault("—")
}

/** "recently uploaded" heuristic for the lab-report "New" pill (no server flag). */
fun isRecent(iso: String?, days: Long = 7): Boolean {
    if (iso.isNullOrBlank()) return false
    return runCatching {
        val t = parseFlexible(iso).toInstant()
        Instant.now().minus(Duration.ofDays(days)).isBefore(t)
    }.getOrDefault(false)
}

fun serviceLabel(category: String?): String = when (category) {
    null -> "Booking"
    "home-visit" -> "Home Visit + Doctor Consult"
    "home-nursing" -> "Home Nursing"
    "lab-tests" -> "Lab Test at Home"
    "teleconsult", "teleconsultation" -> "Teleconsultation"
    else -> category.split('-', '_').filter { it.isNotBlank() }
        .joinToString(" ") { it.replaceFirstChar { c -> c.uppercase() } }
}

data class StatusPill(val label: String, val fg: Color, val bg: Color)

private val Green = Color(0xFF047857) to Color(0xFFECFDF5)
private val Rose = Color(0xFFB91C1C) to Color(0xFFFEF2F2)
private val Amber = Color(0xFFB45309) to Color(0xFFFFFBEB)
private val Blue = Color(0xFF2B81FF) to Color(0xFFEAF2FF)
private val Slate = Color(0xFF475569) to Color(0xFFF1F5F9)

fun bookingPill(status: String): StatusPill {
    val label = status.lowercase().split('-', '_').filter { it.isNotBlank() }
        .joinToString(" ") { it.replaceFirstChar { c -> c.uppercase() } }
        .ifBlank { "Booked" }
    val (fg, bg) = when (status.uppercase()) {
        "COMPLETED" -> Green
        "CANCELLED" -> Rose
        "DISPATCHED", "CONFIRMED" -> Blue
        else -> Slate
    }
    return StatusPill(label, fg, bg)
}

fun invoicePill(status: String): StatusPill = when (status.uppercase()) {
    "REFUNDED" -> StatusPill("Refunded", Amber.first, Amber.second)
    else -> StatusPill("Paid", Green.first, Green.second)
}

// ── Vitals ────────────────────────────────────────────────────────────────────

data class VitalKindMeta(val key: String, val label: String, val unit: String, val hasSecondary: Boolean)

/** The kinds the app lets a patient log (M2: BP / pulse / sugar / weight). */
val LOGGABLE_VITALS: List<VitalKindMeta> = listOf(
    VitalKindMeta("bp", "Blood pressure", "mmHg", true),
    VitalKindMeta("pulse_bpm", "Pulse", "bpm", false),
    VitalKindMeta("sugar_random", "Blood sugar", "mg/dL", false),
    VitalKindMeta("weight_kg", "Weight", "kg", false),
)

private val VITAL_LABELS = mapOf(
    "bp" to ("Blood pressure" to "mmHg"),
    "pulse_bpm" to ("Pulse" to "bpm"),
    "sugar_random" to ("Blood sugar" to "mg/dL"),
    "sugar_fasting" to ("Blood sugar (fasting)" to "mg/dL"),
    "sugar_postprandial" to ("Blood sugar (post-meal)" to "mg/dL"),
    "weight_kg" to ("Weight" to "kg"),
    "temperature_c" to ("Temperature" to "°C"),
    "spo2_pct" to ("SpO₂" to "%"),
)

fun vitalLabel(kind: String): String = VITAL_LABELS[kind]?.first
    ?: kind.split('_').joinToString(" ") { it.replaceFirstChar { c -> c.uppercase() } }

fun vitalUnit(kind: String): String = VITAL_LABELS[kind]?.second ?: ""

/** "128/82" for BP, else the primary value, trimming a trailing ".0". */
fun vitalValueText(kind: String, primary: Double?, secondary: Double?): String {
    fun n(d: Double?): String = d?.let { if (it % 1.0 == 0.0) it.toLong().toString() else it.toString() } ?: "—"
    return if (kind == "bp" && secondary != null) "${n(primary)}/${n(secondary)}" else n(primary)
}

fun severityLabel(severity: String): String =
    severity.replaceFirstChar { it.uppercase() }

fun severityPill(severity: String): StatusPill = when (severity.lowercase()) {
    "severe" -> StatusPill("Severe", Rose.first, Rose.second)
    "moderate" -> StatusPill("Moderate", Amber.first, Amber.second)
    "mild" -> StatusPill("Mild", Slate.first, Slate.second)
    else -> StatusPill(severity.replaceFirstChar { it.uppercase() }.ifBlank { "Unknown" }, Slate.first, Slate.second)
}

/** IST "today" as YYYY-MM-DD, for defaulting a vital's taken_at / a noted_at. */
fun istTodayYmd(): String = java.time.LocalDate.now(IST).toString()

/** IST "now" as an ISO instant, for a vital's taken_at. */
fun istNowIso(): String = java.time.Instant.now().toString()
