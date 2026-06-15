package `in`.sanocare.medic.ui.login

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

// Phase 0: navigation shell between phone entry → OTP entry. No network
// calls yet — onSubmit handlers just advance to the next screen with the
// phone number echoed forward. Phase 1 wires the real send-otp +
// verify-otp endpoints reusing the Pulse OTP routes (per brief §6).

private object Routes {
    const val PHONE = "login/phone"
    const val OTP = "login/otp/{phone}"
    fun otp(phone: String) = "login/otp/$phone"
}

@Composable
fun LoginFlow(contentPadding: PaddingValues) {
    val navController = rememberNavController()
    NavHost(
        navController = navController,
        startDestination = Routes.PHONE,
    ) {
        composable(Routes.PHONE) {
            PhoneEntryScreen(
                contentPadding = contentPadding,
                onSendOtp = { phone -> navController.navigate(Routes.otp(phone)) },
            )
        }
        composable(Routes.OTP) { backStackEntry ->
            val phone = backStackEntry.arguments?.getString("phone").orEmpty()
            OtpEntryScreen(
                phone = phone,
                contentPadding = contentPadding,
                onBack = { navController.popBackStack() },
                // Phase 0: Verify is a UI-only no-op; Phase 1 will route to
                // the MainShell on success or surface an inline error.
                onVerify = { /* no-op */ },
            )
        }
    }
}
