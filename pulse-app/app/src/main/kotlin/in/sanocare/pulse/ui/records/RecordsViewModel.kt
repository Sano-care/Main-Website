package `in`.sanocare.pulse.ui.records

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.sanocare.pulse.data.network.RecordsPayload
import `in`.sanocare.pulse.data.records.MemberScopeStore
import `in`.sanocare.pulse.data.records.RecordsRepository
import `in`.sanocare.pulse.data.records.RecordsResult
import `in`.sanocare.pulse.data.records.SelectedMember
import `in`.sanocare.pulse.data.records.WriteResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject

// PB3 — one VM for the whole Records surface. Reloads whenever the selected
// member changes (collects MemberScopeStore.selected), so switching member
// re-scopes every list. Writes reload silently (no skeleton flash).

@HiltViewModel
class RecordsViewModel @Inject constructor(
    private val repo: RecordsRepository,
    scope: MemberScopeStore,
) : ViewModel() {

    private val _state = MutableStateFlow<RecordsUiState>(RecordsUiState.Loading)
    val state: StateFlow<RecordsUiState> = _state.asStateFlow()

    /** The active subject — drives "for your account" copy for account-level tiers. */
    val selected: StateFlow<SelectedMember> = scope.selected

    init {
        viewModelScope.launch {
            // Fires immediately (current value) and on every member switch.
            scope.selected.collect { reload(showLoading = true) }
        }
    }

    fun reload(showLoading: Boolean = true) {
        if (showLoading || _state.value !is RecordsUiState.Ready) _state.value = RecordsUiState.Loading
        viewModelScope.launch {
            _state.value = when (val r = repo.load()) {
                is RecordsResult.Data -> RecordsUiState.Ready(r.payload)
                RecordsResult.Unauthorized -> RecordsUiState.Unauthorized
                is RecordsResult.Error -> RecordsUiState.Error(r.message)
            }
        }
    }

    suspend fun downloadReceipt(bookingId: String, bookingCode: String?): File? =
        repo.downloadReceipt(bookingId, bookingCode)

    // ── Writes (return the result to the caller; refresh the list on success) ──
    suspend fun logVital(kind: String, value: Double, secondary: Double?, takenAtIso: String, note: String?) =
        repo.logVital(kind, value, secondary, takenAtIso, note).also(::refreshOnOk)

    suspend fun deleteVital(id: String) = repo.deleteVital(id).also(::refreshOnOk)

    suspend fun addMedication(name: String, dose: String, frequency: String, timesPerDay: Int, startDate: String?, endDate: String?, reason: String?) =
        repo.addMedication(name, dose, frequency, timesPerDay, startDate, endDate, reason).also(::refreshOnOk)

    suspend fun deleteMedication(id: String) = repo.deleteMedication(id).also(::refreshOnOk)

    suspend fun addCondition(label: String, status: String?, notedAt: String?, notes: String?) =
        repo.addCondition(label, status, notedAt, notes).also(::refreshOnOk)

    suspend fun deleteCondition(id: String) = repo.deleteCondition(id).also(::refreshOnOk)

    suspend fun addAllergy(label: String, severity: String?, reaction: String?, notedAt: String?, notes: String?) =
        repo.addAllergy(label, severity, reaction, notedAt, notes).also(::refreshOnOk)

    suspend fun deleteAllergy(id: String) = repo.deleteAllergy(id).also(::refreshOnOk)

    suspend fun uploadDocument(uri: Uri) = repo.uploadDocument(uri, docType = null).also(::refreshOnOk)

    suspend fun documentSignedUrl(docId: String): String? = repo.documentSignedUrl(docId)

    private fun refreshOnOk(r: WriteResult) {
        if (r is WriteResult.Ok) reload(showLoading = false)
    }
}

sealed interface RecordsUiState {
    data object Loading : RecordsUiState
    data class Ready(val payload: RecordsPayload) : RecordsUiState
    data object Unauthorized : RecordsUiState
    data class Error(val message: String) : RecordsUiState
}
