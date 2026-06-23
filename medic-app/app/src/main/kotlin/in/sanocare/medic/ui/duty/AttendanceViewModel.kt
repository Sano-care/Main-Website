package `in`.sanocare.medic.ui.duty

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import `in`.sanocare.medic.data.attendance.AttendanceRepository
import `in`.sanocare.medic.data.auth.AuthResult
import `in`.sanocare.medic.data.location.Coords
import `in`.sanocare.medic.data.location.LocationProvider
import `in`.sanocare.medic.data.network.AttendanceRow
import `in`.sanocare.medic.data.network.SelfiePrompt
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

    // No init-refresh: AttendanceSection calls refresh() on every mount
    // (LaunchedEffect), so the single refresh path also re-syncs this
    // (activity-scoped, sign-out-surviving) VM to whoever is signed in now —
    // the account-switch fix. See reset() for the sign-out teardown.
    suspend fun refresh() {
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
                    Log.d(TAG, "refresh(): openRow already exists, emit StartTracking to re-arm")
                    _events.tryEmit(AttendanceEvent.StartTracking)
                }
            }
            is AuthResult.Err -> _state.update {
                it.copy(loading = false, errorMessage = result.message)
            }
        }
    }

    fun clockIn() {
        Log.d(TAG, "clockIn() entered (acting=${_state.value.acting})")
        if (_state.value.acting) return
        _state.update { it.copy(acting = true, errorMessage = null) }
        viewModelScope.launch {
            val coords: Coords? = locationProvider.current()
            Log.d(TAG, "clockIn(): coords=${if (coords != null) "captured" else "null"}")
            when (val result = attendanceRepository.clockIn(coords?.lat, coords?.lng)) {
                is AuthResult.Ok -> {
                    Log.d(TAG, "clockIn() API ok, openRow=${result.value.openRow.id}")
                    _state.update {
                        it.copy(
                            acting = false,
                            openRow = result.value.openRow,
                            errorMessage = null,
                            hasLocation = coords != null,
                            selfiePrompt = result.value.selfiePrompt,
                        )
                    }
                    val emitted = _events.tryEmit(AttendanceEvent.StartTracking)
                    Log.d(TAG, "Emit StartTracking (tryEmit=$emitted)")
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
                    Log.d(TAG, "clockOut() API ok")
                    _state.update {
                        it.copy(
                            acting = false,
                            openRow = null,
                            lastClosedRow = result.value,
                            errorMessage = null,
                            selfiePrompt = null,
                        )
                    }
                    val emitted = _events.tryEmit(AttendanceEvent.StopTracking)
                    Log.d(TAG, "Emit StopTracking (tryEmit=$emitted)")
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

    /** Dismiss the post-clock-in selfie nudge (medic sent it, or tapped close). */
    fun dismissSelfiePrompt() {
        _state.update { it.copy(selfiePrompt = null) }
    }

    /**
     * Account-switch teardown (T65 Phase 1.5 #88). This VM is activity-scoped
     * and survives sign-out → sign-in on the same device, so the previous
     * medic's state must be wiped explicitly. Clears the replay cache too, so
     * the prior medic's buffered StartTracking is NOT re-delivered to the next
     * medic's AttendanceSection (which would spuriously start tracking under a
     * medic who never clocked in). Called from the sign-out path, which also
     * stops the foreground service.
     */
    fun reset() {
        _events.resetReplayCache()
        _state.value = AttendanceState()
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
    // Set from the clock_in response; drives the post-clock-in selfie nudge.
    val selfiePrompt: SelfiePrompt? = null,
)
