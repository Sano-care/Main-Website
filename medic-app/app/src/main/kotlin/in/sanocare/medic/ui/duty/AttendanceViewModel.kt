package `in`.sanocare.medic.ui.duty

import android.util.Log
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

private const val TAG = "AttendanceVM"

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

    // T65 Phase 1.5 hotfix — replay=1 so late-subscribing LaunchedEffect
    // (e.g. AttendanceScreen remount after a tab switch, or any composition
    // race between VM init refresh() emit and Compose's commit-phase
    // LaunchedEffect coroutine launch) still receives the most recent
    // tracking intent. Service start/stop is idempotent so re-delivering
    // the same event is harmless.
    private val _events = MutableSharedFlow<AttendanceEvent>(
        replay = 1,
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
                    Log.i(TAG, "refresh(): openRow already exists, emit StartTracking to re-arm")
                    _events.tryEmit(AttendanceEvent.StartTracking)
                }
            }
            is AuthResult.Err -> _state.update {
                it.copy(loading = false, errorMessage = result.message)
            }
        }
    }

    fun clockIn() {
        Log.i(TAG, "clockIn() entered (acting=${_state.value.acting})")
        if (_state.value.acting) return
        _state.update { it.copy(acting = true, errorMessage = null) }
        viewModelScope.launch {
            val coords: Coords? = locationProvider.current()
            Log.i(TAG, "clockIn(): coords=${if (coords != null) "captured" else "null"}")
            when (val result = attendanceRepository.clockIn(coords?.lat, coords?.lng)) {
                is AuthResult.Ok -> {
                    Log.i(TAG, "clockIn() API ok, openRow=${result.value.id}")
                    _state.update {
                        it.copy(
                            acting = false,
                            openRow = result.value,
                            errorMessage = null,
                            hasLocation = coords != null,
                        )
                    }
                    val emitted = _events.tryEmit(AttendanceEvent.StartTracking)
                    Log.i(TAG, "Emit StartTracking (tryEmit=$emitted)")
                }
                is AuthResult.Err -> {
                    Log.w(TAG, "clockIn() API err: ${result.message} (code=${result.code})")
                    _state.update {
                        it.copy(acting = false, errorMessage = result.message)
                    }
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
                    Log.i(TAG, "clockOut() API ok")
                    _state.update {
                        it.copy(
                            acting = false,
                            openRow = null,
                            lastClosedRow = result.value,
                            errorMessage = null,
                        )
                    }
                    val emitted = _events.tryEmit(AttendanceEvent.StopTracking)
                    Log.i(TAG, "Emit StopTracking (tryEmit=$emitted)")
                }
                is AuthResult.Err -> {
                    Log.w(TAG, "clockOut() API err: ${result.message}; stopping service locally")
                    _state.update {
                        it.copy(acting = false, errorMessage = result.message)
                    }
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
