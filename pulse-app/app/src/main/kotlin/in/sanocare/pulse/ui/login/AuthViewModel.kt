package `in`.sanocare.pulse.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import `in`.sanocare.pulse.data.auth.AuthRepository
import `in`.sanocare.pulse.data.auth.AuthResult
import `in`.sanocare.pulse.data.auth.VerifyOutcome
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

// PB1 — login flow VM. Owns phone/OTP transient state, the resend cooldown, and
// the medic-number banner. Success routes through onCustomer(isNewCustomer) so
// the AuthGate can decide onboarding vs home.

private const val RESEND_COOLDOWN_SECONDS = 24

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(AuthUiState())
    val state: StateFlow<AuthUiState> = _state.asStateFlow()

    fun sendOtp(phone: String, onSent: () -> Unit) {
        if (_state.value.sending) return
        _state.update { it.copy(sending = true, errorMessage = null, medicNumber = false) }
        viewModelScope.launch {
            when (val result = authRepository.sendOtp(phone)) {
                is AuthResult.Ok -> {
                    _state.update { it.copy(sending = false) }
                    startResendCooldown()
                    onSent()
                }
                is AuthResult.Err -> _state.update {
                    it.copy(sending = false, errorMessage = result.message)
                }
            }
        }
    }

    fun resend(phone: String) {
        if (_state.value.resendSeconds > 0 || _state.value.sending) return
        sendOtp(phone) { /* stays on OTP screen */ }
    }

    fun verifyOtp(phone: String, otp: String, onCustomer: (isNewCustomer: Boolean) -> Unit) {
        if (_state.value.verifying) return
        _state.update { it.copy(verifying = true, errorMessage = null) }
        viewModelScope.launch {
            when (val outcome = authRepository.verifyOtp(phone, otp)) {
                is VerifyOutcome.Customer -> {
                    _state.update { it.copy(verifying = false) }
                    onCustomer(outcome.isNewCustomer)
                }
                VerifyOutcome.MedicNumber -> _state.update {
                    it.copy(verifying = false, medicNumber = true)
                }
                is VerifyOutcome.Error -> _state.update {
                    it.copy(verifying = false, errorMessage = outcome.message)
                }
            }
        }
    }

    fun clearTransient() {
        _state.update { it.copy(errorMessage = null, medicNumber = false) }
    }

    private fun startResendCooldown() {
        _state.update { it.copy(resendSeconds = RESEND_COOLDOWN_SECONDS) }
        viewModelScope.launch {
            while (_state.value.resendSeconds > 0) {
                delay(1000)
                _state.update { it.copy(resendSeconds = (it.resendSeconds - 1).coerceAtLeast(0)) }
            }
        }
    }
}

data class AuthUiState(
    val sending: Boolean = false,
    val verifying: Boolean = false,
    val errorMessage: String? = null,
    val medicNumber: Boolean = false,
    val resendSeconds: Int = 0,
)
