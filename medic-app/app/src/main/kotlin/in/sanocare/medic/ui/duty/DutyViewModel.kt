package `in`.sanocare.medic.ui.duty

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import `in`.sanocare.medic.data.auth.AuthResult
import `in`.sanocare.medic.data.duty.DutyRepository
import `in`.sanocare.medic.data.network.BookingDto
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

// T65 Phase 2 C6 — Duty roster VM.
//
// state: Loading → Success(bookings) | Error(message). `refreshing` drives
// the pull-to-refresh indicator separately so a manual refresh doesn't blank
// the list back to a spinner. refresh() is called on init, on swipe-down,
// and on tab focus (DutyTab LaunchedEffect).

sealed interface DutyState {
    data object Loading : DutyState
    data class Success(val bookings: List<BookingDto>) : DutyState
    data class Error(val message: String) : DutyState
}

@HiltViewModel
class DutyViewModel @Inject constructor(
    private val repository: DutyRepository,
) : ViewModel() {

    private val _state = MutableStateFlow<DutyState>(DutyState.Loading)
    val state: StateFlow<DutyState> = _state.asStateFlow()

    private val _refreshing = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = _refreshing.asStateFlow()

    // No init-refresh: DutyTab's LaunchedEffect owns the first load AND the
    // tab-focus reload, so there's a single refresh path (no cold-start
    // double fetch).

    fun refresh() {
        viewModelScope.launch {
            _refreshing.value = true
            when (val result = repository.fetchDuty(null)) {
                is AuthResult.Ok -> _state.value = DutyState.Success(result.value)
                is AuthResult.Err -> {
                    // Keep any already-loaded list on a transient refresh
                    // failure; only show the Error surface if we have nothing.
                    if (_state.value !is DutyState.Success) {
                        _state.value = DutyState.Error(result.message)
                    }
                }
            }
            _refreshing.value = false
        }
    }
}
