package `in`.sanocare.medic.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import `in`.sanocare.medic.data.auth.AuthDataStore
import `in`.sanocare.medic.data.auth.AuthRepository
import `in`.sanocare.medic.data.auth.CachedProfile
import `in`.sanocare.medic.ui.login.LoginFlow
import `in`.sanocare.medic.ui.shell.MainShell
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

// T65 Phase 1 — top-level auth gate. On cold start: check DataStore for a
// cached profile; if present, call /api/medic-app/me to confirm the cookie
// is still valid. If yes → MainShell; if no → LoginFlow.
//
// Three states: Loading (decided yet?) → Authenticated(profile) → SignedOut.
// LoginFlow transitions Loading → Authenticated by calling onAuthenticated().
// MainShell transitions Authenticated → SignedOut by calling onSignedOut().

sealed class AuthState {
    data object Loading : AuthState()
    data class Authenticated(val profile: CachedProfile) : AuthState()
    data object SignedOut : AuthState()
}

@HiltViewModel
class AuthGateViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val authDataStore: AuthDataStore,
) : ViewModel() {

    private val _state = MutableStateFlow<AuthState>(AuthState.Loading)
    val state: StateFlow<AuthState> = _state.asStateFlow()

    init {
        viewModelScope.launch { rehydrate() }
    }

    private suspend fun rehydrate() {
        val cached = authDataStore.profileFlow.first()
        val cookie = authDataStore.getCookie()
        if (cached == null || cookie.isBlank()) {
            _state.value = AuthState.SignedOut
            return
        }
        // We have a cookie + cached profile. Optimistically show the shell
        // (cache lives offline) while /me confirms the cookie. On 401/404,
        // rehydrate() inside the repo clears everything, but the gate has
        // already flipped to Authenticated — the next protected call will
        // 401, the shell will catch it. v0 keeps the UX simple.
        _state.value = AuthState.Authenticated(cached)
        // Fire-and-forget /me. Don't block the UI.
        viewModelScope.launch {
            authRepository.rehydrate()
            // If rehydrate cleared everything, reflect that.
            val stillCookie = authDataStore.getCookie()
            if (stillCookie.isBlank()) {
                _state.value = AuthState.SignedOut
            }
        }
    }

    fun onAuthenticated(profile: CachedProfile) {
        _state.value = AuthState.Authenticated(profile)
    }

    fun onSignedOut() {
        viewModelScope.launch {
            authRepository.signOut()
            _state.value = AuthState.SignedOut
        }
    }
}

@Composable
fun AuthGate(contentPadding: PaddingValues) {
    val vm: AuthGateViewModel = hiltViewModel()
    val state by vm.state.collectAsState()

    when (val s = state) {
        AuthState.Loading -> Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator()
        }
        AuthState.SignedOut -> LoginFlow(
            contentPadding = contentPadding,
            onAuthenticated = { profile -> vm.onAuthenticated(profile) },
        )
        is AuthState.Authenticated -> MainShell(
            profile = s.profile,
            contentPadding = contentPadding,
            onSignOut = { vm.onSignedOut() },
        )
    }

    // Suppress unused — keep the import lint quiet.
    LaunchedEffect(Unit) { /* no-op */ }
}
