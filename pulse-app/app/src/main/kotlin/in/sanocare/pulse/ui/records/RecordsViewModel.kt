package `in`.sanocare.pulse.ui.records

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.sanocare.pulse.data.network.RecordsPayload
import `in`.sanocare.pulse.data.records.RecordsRepository
import `in`.sanocare.pulse.data.records.RecordsResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject

// PB2 — one VM for the whole Records surface. Loads /api/pulse/records once
// (shared across hub + all lists + details), and delegates the bearer receipt
// download. 401 surfaces as Unauthorized so the screen routes to login.

@HiltViewModel
class RecordsViewModel @Inject constructor(
    private val repo: RecordsRepository,
) : ViewModel() {

    private val _state = MutableStateFlow<RecordsUiState>(RecordsUiState.Loading)
    val state: StateFlow<RecordsUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.value = RecordsUiState.Loading
        viewModelScope.launch {
            _state.value = when (val r = repo.load()) {
                is RecordsResult.Data -> RecordsUiState.Ready(r.payload)
                RecordsResult.Unauthorized -> RecordsUiState.Unauthorized
                is RecordsResult.Error -> RecordsUiState.Error(r.message)
            }
        }
    }

    /** Download the bearer receipt PDF; returns the cached File or null on failure. */
    suspend fun downloadReceipt(bookingId: String, bookingCode: String?): File? =
        repo.downloadReceipt(bookingId, bookingCode)
}

sealed interface RecordsUiState {
    data object Loading : RecordsUiState
    data class Ready(val payload: RecordsPayload) : RecordsUiState
    data object Unauthorized : RecordsUiState
    data class Error(val message: String) : RecordsUiState
}
