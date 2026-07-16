package `in`.sanocare.pulse.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.sanocare.pulse.data.auth.AuthRepository
import `in`.sanocare.pulse.data.auth.CachedCustomer
import `in`.sanocare.pulse.ui.login.LoginFlow
import `in`.sanocare.pulse.ui.onboarding.OnboardingFlow
import `in`.sanocare.pulse.ui.shell.MainShell
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

// PB1 — top-level auth gate. Cold start probes the bearer session
// (/api/pulse/records); a live session lands home (or onboarding on first
// sign-up), a revoked/absent one lands on login.

sealed class GateState {
    data object Loading : GateState()
    data object SignedOut : GateState()
    data object Onboarding : GateState()
    data class Ready(val customer: CachedCustomer) : GateState()
}

@HiltViewModel
class AuthGateViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _state = MutableStateFlow<GateState>(GateState.Loading)
    val state: StateFlow<GateState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            val signedIn = authRepository.checkSession()
            _state.value = if (signedIn) GateState.Ready(authRepository.cached()) else GateState.SignedOut
        }
    }

    fun onAuthenticated(isNewCustomer: Boolean) {
        _state.value =
            if (isNewCustomer && !authRepository.isOnboardingDone()) GateState.Onboarding
            else GateState.Ready(authRepository.cached())
    }

    fun onOnboardingFinished() {
        authRepository.markOnboardingDone()
        _state.value = GateState.Ready(authRepository.cached())
    }

    fun onSignedOut() {
        viewModelScope.launch {
            authRepository.signOut()
            _state.value = GateState.SignedOut
        }
    }
}

@Composable
fun AuthGate(modifier: Modifier = Modifier) {
    val vm: AuthGateViewModel = hiltViewModel()
    val state by vm.state.collectAsState()

    Box(modifier = modifier) {
        when (val s = state) {
            GateState.Loading -> Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) { CircularProgressIndicator() }

            GateState.SignedOut -> LoginFlow(
                onAuthenticated = { isNew -> vm.onAuthenticated(isNew) },
            )

            GateState.Onboarding -> OnboardingFlow(onFinish = { vm.onOnboardingFinished() })

            is GateState.Ready -> MainShell(
                customer = s.customer,
                onSignOut = { vm.onSignedOut() },
            )
        }
    }
}
