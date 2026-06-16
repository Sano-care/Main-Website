package `in`.sanocare.medic.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import `in`.sanocare.medic.data.auth.AuthRepository
import `in`.sanocare.medic.data.auth.AuthResult
import `in`.sanocare.medic.data.auth.CachedProfile
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

// T65 Phase 1 — login flow VM. Owns transient send-OTP / verify-OTP
// in-flight state + the most recent server error string. Surfaces success
// via `verifySuccess` events that the LoginFlow consumes to switch the
// AuthGate to the verified state.

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(AuthFormState())
    val state: StateFlow<AuthFormState> = _state.asStateFlow()

    fun sendOtp(phone: String, onSent: () -> Unit) {
        if (_state.value.sending) return
        _state.update { it.copy(sending = true, errorMessage = null) }
        viewModelScope.launch {
            when (val result = authRepository.sendOtp(phone)) {
                is AuthResult.Ok -> {
                    _state.update { it.copy(sending = false, errorMessage = null) }
                    onSent()
                }
                is AuthResult.Err -> {
                    _state.update {
                        it.copy(sending = false, errorMessage = result.message)
                    }
                }
            }
        }
    }

    fun verifyOtp(phone: String, otp: String, onVerified: (CachedProfile) -> Unit) {
        if (_state.value.verifying) return
        _state.update { it.copy(verifying = true, errorMessage = null) }
        viewModelScope.launch {
            when (val result = authRepository.verifyOtp(phone, otp)) {
                is AuthResult.Ok -> {
                    _state.update { it.copy(verifying = false, errorMessage = null) }
                    onVerified(result.value)
                }
                is AuthResult.Err -> {
                    _state.update {
                        it.copy(verifying = false, errorMessage = result.message)
                    }
                }
            }
        }
    }

    fun clearError() {
        _state.update { it.copy(errorMessage = null) }
    }
}

data class AuthFormState(
    val sending: Boolean = false,
    val verifying: Boolean = false,
    val errorMessage: String? = null,
)
