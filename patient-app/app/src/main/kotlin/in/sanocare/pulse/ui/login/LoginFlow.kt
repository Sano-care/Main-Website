package `in`.sanocare.pulse.ui.login

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue

// Phase 0: pure UI navigation between the two login shell screens. No network,
// no token persistence — tapping "Send code" just advances to the OTP screen.
// Phase 1 replaces this with an AuthViewModel that calls /api/auth/send-otp +
// /api/auth/verify-otp and persists the session via DataStore.
private enum class LoginStep { Phone, Otp }

@Composable
fun LoginFlow(contentPadding: PaddingValues = PaddingValues()) {
    var step by rememberSaveable { mutableStateOf(LoginStep.Phone) }
    var phone by rememberSaveable { mutableStateOf("") }

    when (step) {
        LoginStep.Phone ->
            PhoneEntryScreen(
                phone = phone,
                onPhoneChange = { phone = it },
                onSubmit = { step = LoginStep.Otp },
                contentPadding = contentPadding,
            )
        LoginStep.Otp ->
            OtpEntryScreen(
                phone = phone,
                onBack = { step = LoginStep.Phone },
                onVerify = { /* Phase 1 wires verify-otp + session persistence */ },
                contentPadding = contentPadding,
            )
    }
}
