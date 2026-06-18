package `in`.sanocare.medic.ui.duty

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import `in`.sanocare.medic.data.auth.AuthResult
import `in`.sanocare.medic.data.duty.DutyRepository
import `in`.sanocare.medic.data.location.LocationProvider
import `in`.sanocare.medic.data.network.EventDto
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

// T65 Phase 2 C7 — BookingDetailScreen VM. Owns the 4-event sequence state.
//
// recordedAt: event → occurred_at ISO (seeded from the booking's events,
// grown as the medic fires each one). `firing` is the event currently
// posting (drives the per-button spinner + disables the row). One-shot
// effects (visit-done toast, 401 redirect) go through `effects`.

val EVENT_ORDER = listOf("departed", "reached", "visit_started", "visit_done")

data class BookingDetailState(
    val recordedAt: Map<String, String> = emptyMap(),
    val firing: String? = null,
)

sealed interface BookingDetailEffect {
    data object VisitDone : BookingDetailEffect
    data object Unauthorized : BookingDetailEffect
    data class Failure(val event: String) : BookingDetailEffect
}

@HiltViewModel
class BookingDetailViewModel @Inject constructor(
    private val repository: DutyRepository,
    private val locationProvider: LocationProvider,
) : ViewModel() {

    private val _state = MutableStateFlow(BookingDetailState())
    val state: StateFlow<BookingDetailState> = _state.asStateFlow()

    private val _effects = MutableSharedFlow<BookingDetailEffect>(extraBufferCapacity = 4)
    val effects: SharedFlow<BookingDetailEffect> = _effects.asSharedFlow()

    private var seeded = false

    /** Seed recorded events from the booking once (idempotent across recomposition). */
    fun seed(events: List<EventDto>) {
        if (seeded) return
        seeded = true
        _state.update {
            it.copy(recordedAt = events.associate { e -> e.event to e.occurredAt })
        }
    }

    fun fireEvent(bookingId: String, event: String) {
        if (_state.value.firing != null) return
        if (_state.value.recordedAt.containsKey(event)) return
        _state.update { it.copy(firing = event) }
        viewModelScope.launch {
            // Best-effort single-shot location — null is acceptable (the
            // event route accepts null lat/lng).
            val coords = locationProvider.current()
            when (val result =
                repository.recordEvent(bookingId, event, coords?.lat, coords?.lng)) {
                is AuthResult.Ok -> {
                    val recordedAt = result.value.recordedAt ?: ""
                    _state.update {
                        it.copy(
                            firing = null,
                            recordedAt = it.recordedAt + (event to recordedAt),
                        )
                    }
                    if (event == "visit_done") {
                        _effects.tryEmit(BookingDetailEffect.VisitDone)
                    }
                }
                is AuthResult.Err -> {
                    _state.update { it.copy(firing = null) }
                    if (result.code == 401) {
                        _effects.tryEmit(BookingDetailEffect.Unauthorized)
                    } else {
                        _effects.tryEmit(BookingDetailEffect.Failure(event))
                    }
                }
            }
        }
    }
}
