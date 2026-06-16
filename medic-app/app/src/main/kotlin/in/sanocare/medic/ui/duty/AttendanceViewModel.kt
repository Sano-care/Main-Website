package `in`.sanocare.medic.ui.duty

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import `in`.sanocare.medic.data.attendance.AttendanceRepository
import `in`.sanocare.medic.data.auth.AuthResult
import `in`.sanocare.medic.data.location.Coords
import `in`.sanocare.medic.data.location.LocationProvider
import `in`.sanocare.medic.data.network.AttendanceRow
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

// T65 Phase 1 C4 — Attendance VM. On init, fetches the current open row.
// On clock-in / clock-out, asks LocationProvider for coords (null if
// denied) then calls the repo.

@HiltViewModel
class AttendanceViewModel @Inject constructor(
    private val attendanceRepository: AttendanceRepository,
    private val locationProvider: LocationProvider,
) : ViewModel() {

    private val _state = MutableStateFlow(AttendanceState())
    val state: StateFlow<AttendanceState> = _state.asStateFlow()

    init {
        viewModelScope.launch { refresh() }
    }

    private suspend fun refresh() {
        _state.update { it.copy(loading = true, errorMessage = null) }
        when (val result = attendanceRepository.fetchOpen()) {
            is AuthResult.Ok -> _state.update {
                it.copy(loading = false, openRow = result.value, errorMessage = null)
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
                is AuthResult.Ok -> _state.update {
                    it.copy(
                        acting = false,
                        openRow = result.value,
                        errorMessage = null,
                        hasLocation = coords != null,
                    )
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
                is AuthResult.Ok -> _state.update {
                    it.copy(
                        acting = false,
                        openRow = null,
                        lastClosedRow = result.value,
                        errorMessage = null,
                    )
                }
                is AuthResult.Err -> _state.update {
                    it.copy(acting = false, errorMessage = result.message)
                }
            }
        }
    }

    fun clearError() {
        _state.update { it.copy(errorMessage = null) }
    }
}

data class AttendanceState(
    val loading: Boolean = true,
    val acting: Boolean = false,
    val openRow: AttendanceRow? = null,
    val lastClosedRow: AttendanceRow? = null,
    val errorMessage: String? = null,
    val hasLocation: Boolean = false,
)
