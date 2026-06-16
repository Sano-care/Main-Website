package `in`.sanocare.medic.ui.duty

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import `in`.sanocare.medic.data.attendance.AttendanceRepository
import `in`.sanocare.medic.data.auth.AuthResult
import `in`.sanocare.medic.data.location.Coords
import `in`.sanocare.medic.data.location.LocationProvider
import `in`.sanocare.medic.data.network.AttendanceRow
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

// T65 Phase 1 C4 + Phase 1.5 — Attendance VM.
//
// State: loading/openRow/lastClosedRow/errorMessage/hasLocation (StateFlow).
// Events: AttendanceEvent.StartTracking / StopTracking emitted on clock-in
// and clock-out success respectively. AttendanceScreen observes the event
// flow and dispatches startForegroundService / stopService — keeping the
// VM context-free.

@HiltViewModel
class AttendanceViewModel @Inject constructor(
    private val attendanceRepository: AttendanceRepository,
    private val locationProvider: LocationProvider,
) : ViewModel() {

    private val _state = MutableStateFlow(AttendanceState())
    val state: StateFlow<AttendanceState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<AttendanceEvent>(
        extraBufferCapacity = 4,
    )
    val events: SharedFlow<AttendanceEvent> = _events.asSharedFlow()

    init {
        viewModelScope.launch { refresh() }
    }

    private suspend fun refresh() {
        _state.update { it.copy(loading = true, errorMessage = null) }
        when (val result = attendanceRepository.fetchOpen()) {
            is AuthResult.Ok -> {
                _state.update {
                    it.copy(loading = false, openRow = result.value, errorMessage = null)
                }
                // T65 Phase 1.5: re-arm the foreground service on app restart
                // if we cold-start mid-shift (medic force-killed the app while
                // clocked in). The service is single-instance so a duplicate
                // start is a no-op when it's already running.
                if (result.value != null) {
                    _events.tryEmit(AttendanceEvent.StartTracking)
                }
            }
            is AuthResult.Err -> _state.update {
                it.copy(loading = false, errorMessage = result.message)
            }
        }
    }

    fun clockIn() {
        if (_state.value.acting) return
        _state.update { it.copy(acting = true, errorMessage = null) }
        viewModelScope.launch {
            val coords: Coords? = locationProvider.current()
            when (val result = attendanceRepository.clockIn(coords?.lat, coords?.lng)) {
                is AuthResult.Ok -> {
                    _state.update {
                        it.copy(
                            acting = false,
                            openRow = result.value,
                            errorMessage = null,
                            hasLocation = coords != null,
                        )
                    }
                    _events.tryEmit(AttendanceEvent.StartTracking)
                }
                is AuthResult.Err -> _state.update {
                    it.copy(acting = false, errorMessage = result.message)
                }
            }
        }
    }

    fun clockOut() {
        if (_state.value.acting) return
        _state.update { it.copy(acting = true, errorMessage = null) }
        viewModelScope.launch {
            val coords: Coords? = locationProvider.current()
            when (val result = attendanceRepository.clockOut(coords?.lat, coords?.lng)) {
                is AuthResult.Ok -> {
                    _state.update {
                        it.copy(
                            acting = false,
                            openRow = null,
                            lastClosedRow = result.value,
                            errorMessage = null,
                        )
                    }
                    // Stop tracking REGARDLESS of clock-out API result on the
                    // server. If the server failed, the medic can retry; the
                    // foreground service running while clocked-out-locally is
                    // worse UX than a stale clock-out row (the route
                    // soft-rejects pings without an open attendance row anyway).
                    _events.tryEmit(AttendanceEvent.StopTracking)
                }
                is AuthResult.Err -> {
                    _state.update {
                        it.copy(acting = false, errorMessage = result.message)
                    }
                    // Network drop on clock-out — stop the service locally so
                    // we're not pinging while the medic thinks they're off
                    // duty. The next clock-in will start it again.
                    _events.tryEmit(AttendanceEvent.StopTracking)
                }
            }
        }
    }

    fun setError(message: String) {
        _state.update { it.copy(errorMessage = message) }
    }

    fun clearError() {
        _state.update { it.copy(errorMessage = null) }
    }
}

sealed class AttendanceEvent {
    data object StartTracking : AttendanceEvent()
    data object StopTracking : AttendanceEvent()
}

data class AttendanceState(
    val loading: Boolean = true,
    val acting: Boolean = false,
    val openRow: AttendanceRow? = null,
    val lastClosedRow: AttendanceRow? = null,
    val errorMessage: String? = null,
    val hasLocation: Boolean = false,
)
