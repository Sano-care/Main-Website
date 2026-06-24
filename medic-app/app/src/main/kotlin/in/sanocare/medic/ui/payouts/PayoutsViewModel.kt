package `in`.sanocare.medic.ui.payouts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import `in`.sanocare.medic.data.auth.AuthResult
import `in`.sanocare.medic.data.network.PayoutsResponse
import `in`.sanocare.medic.data.payouts.PayoutsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

// Medic payroll — Payouts VM. Mirrors DutyViewModel: Loading → Success | Error,
// with a separate `refreshing` flag for pull-to-refresh so a manual refresh
// doesn't blank an already-loaded screen back to a spinner. PayoutsTab's
// LaunchedEffect owns the first load + tab-focus reload (single refresh path).

sealed interface PayoutsState {
    data object Loading : PayoutsState
    data class Success(val data: PayoutsResponse) : PayoutsState
    data class Error(val message: String) : PayoutsState
}

@HiltViewModel
class PayoutsViewModel @Inject constructor(
    private val repository: PayoutsRepository,
) : ViewModel() {

    private val _state = MutableStateFlow<PayoutsState>(PayoutsState.Loading)
    val state: StateFlow<PayoutsState> = _state.asStateFlow()

    private val _refreshing = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = _refreshing.asStateFlow()

    fun refresh() {
        viewModelScope.launch {
            _refreshing.value = true
            when (val result = repository.fetchPayouts()) {
                is AuthResult.Ok -> _state.value = PayoutsState.Success(result.value)
                is AuthResult.Err -> {
                    // Keep any already-loaded data on a transient refresh failure;
                    // only show the Error surface if we have nothing yet.
                    if (_state.value !is PayoutsState.Success) {
                        _state.value = PayoutsState.Error(result.message)
                    }
                }
            }
            _refreshing.value = false
        }
    }
}
