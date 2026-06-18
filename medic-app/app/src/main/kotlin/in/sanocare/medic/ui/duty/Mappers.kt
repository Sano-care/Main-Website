package `in`.sanocare.medic.ui.duty

import `in`.sanocare.medic.data.network.EventDto
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// T65 Phase 2 C6 — presentation mappers for the duty surface.
//
// All time formatting renders in IST (Asia/Kolkata). minSdk 26 ships
// java.time without desugaring, so Instant/ZonedDateTime are safe.

private val IST: ZoneId = ZoneId.of("Asia/Kolkata")
private val TIME_FMT: DateTimeFormatter =
    DateTimeFormatter.ofPattern("hh:mm a", Locale.ENGLISH)
private val DATETIME_FMT: DateTimeFormatter =
    DateTimeFormatter.ofPattern("d MMM, hh:mm a", Locale.ENGLISH)

/** Friendly service-category label. Falls back to a Title-Cased slug. */
fun serviceLabel(category: String?): String = when (category) {
    "home-visit" -> "Home Visit"
    "teleconsult" -> "Teleconsult"
    "lab-tests" -> "Lab Tests"
    "medic-at-home" -> "Medic at Home"
    null, "" -> "Visit"
    else -> category.split('-').joinToString(" ") { part ->
        part.replaceFirstChar { it.uppercase() }
    }
}

/**
 * Visit progress derived from the logged events. `step` is the count of the
 * 4-event sequence completed (0..4); `label` is the chip text.
 *   0 → Not started · 1 → On the way · 2 → Reached patient
 *   3 → In session   · 4 → Completed
 */
data class StatusChip(val label: String, val step: Int)

fun statusChipFor(events: List<EventDto>): StatusChip {
    val fired = events.mapTo(HashSet()) { it.event }
    return when {
        "visit_done" in fired -> StatusChip("Completed", 4)
        "visit_started" in fired -> StatusChip("In session", 3)
        "reached" in fired -> StatusChip("Reached patient", 2)
        "departed" in fired -> StatusChip("On the way", 1)
        else -> StatusChip("Not started", 0)
    }
}

/** "02:45 PM IST" from a UTC ISO-8601 timestamp; passthrough on parse fail. */
fun formatIstTime(iso: String?): String {
    if (iso.isNullOrBlank()) return ""
    return runCatching {
        TIME_FMT.format(Instant.parse(iso).atZone(IST)) + " IST"
    }.getOrDefault(iso)
}

/** "3 Jun, 02:45 PM IST" from a UTC ISO-8601 timestamp; passthrough on fail. */
fun formatIstDateTime(iso: String?): String {
    if (iso.isNullOrBlank()) return ""
    return runCatching {
        DATETIME_FMT.format(Instant.parse(iso).atZone(IST)) + " IST"
    }.getOrDefault(iso)
}
