package `in`.sanocare.pulse.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.sanocare.pulse.data.booking.TeleconsultRepository
import `in`.sanocare.pulse.data.network.BookingDto
import `in`.sanocare.pulse.data.records.MemberScopeStore
import `in`.sanocare.pulse.data.records.PulseExtraRepository
import `in`.sanocare.pulse.data.records.RecordsRepository
import `in`.sanocare.pulse.data.records.RecordsResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.OffsetDateTime
import javax.inject.Inject

// v2 — Home "care at a glance". Loads the member-scoped /records (next
// appointment + book-again) plus account-level meds-due + BP trend, all from
// existing bearer endpoints. Re-scopes on member switch.

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val records: RecordsRepository,
    private val extra: PulseExtraRepository,
    private val teleconsult: TeleconsultRepository,
    scope: MemberScopeStore,
) : ViewModel() {

    private val _state = MutableStateFlow<HomeUiState>(HomeUiState.Loading)
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    // PB4a — server-driven "from ₹399" label for the teleconsult card (the app
    // hardcodes no price). Null until the config GET resolves.
    private val _teleconsultFrom = MutableStateFlow<String?>(null)
    val teleconsultFrom: StateFlow<String?> = _teleconsultFrom.asStateFlow()

    // Pull-to-refresh flag — distinct from the initial Loading state so the mark
    // spins over existing content rather than clearing it.
    private val _refreshing = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = _refreshing.asStateFlow()

    private var loaded = false

    init {
        viewModelScope.launch {
            // Reload on member switch (skip the very first duplicate so we don't double-fetch).
            scope.selected.collect {
                if (loaded) refresh(showLoading = false) else { loaded = true; refresh(showLoading = true) }
            }
        }
        viewModelScope.launch {
            teleconsult.config()?.let { _teleconsultFrom.value = "from ₹${it.displayInr}" }
        }
    }

    fun refresh(showLoading: Boolean = true) {
        viewModelScope.launch { reloadNow(showLoading) }
    }

    /** Pull-to-refresh entry point — keeps current content, spins the mark. */
    fun pullRefresh() {
        viewModelScope.launch {
            _refreshing.value = true
            reloadNow(showLoading = false)
            _refreshing.value = false
        }
    }

    private suspend fun reloadNow(showLoading: Boolean) {
        if (showLoading) _state.value = HomeUiState.Loading
        val recs = records.load()
        if (recs is RecordsResult.Unauthorized) { _state.value = HomeUiState.Unauthorized; return }
        val bookings = (recs as? RecordsResult.Data)?.payload?.bookings ?: emptyList()
        val doses = extra.schedule()
        val bp = extra.bpTrend()
        _state.value = HomeUiState.Ready(
            HomeData(
                nextBooking = nextUpcoming(bookings),
                bookAgain = bookAgain(bookings),
                medsDue = doses.size,
                medsTaken = doses.count { it.state == "taken" },
                bpSeries = bp.takeLast(12),
            ),
        )
    }

    private fun nextUpcoming(bookings: List<BookingDto>): BookingDto? {
        val now = Instant.now()
        return bookings
            .filter { it.status.uppercase() !in setOf("COMPLETED", "CANCELLED") }
            .mapNotNull { b -> parse(b.scheduledFor)?.let { it to b } }
            .filter { it.first.isAfter(now) }
            .minByOrNull { it.first }
            ?.second
    }

    private fun bookAgain(bookings: List<BookingDto>): List<BookingDto> =
        bookings.filter { it.status.uppercase() == "COMPLETED" }
            .distinctBy { it.serviceCategory }
            .take(5)

    private fun parse(iso: String?): Instant? {
        if (iso.isNullOrBlank()) return null
        return runCatching { Instant.parse(iso) }.getOrElse {
            runCatching { OffsetDateTime.parse(iso).toInstant() }.getOrNull()
        }
    }
}

data class HomeData(
    val nextBooking: BookingDto?,
    val bookAgain: List<BookingDto>,
    val medsDue: Int,
    val medsTaken: Int,
    val bpSeries: List<Double>,
)

sealed interface HomeUiState {
    data object Loading : HomeUiState
    data class Ready(val data: HomeData) : HomeUiState
    data object Unauthorized : HomeUiState
}
