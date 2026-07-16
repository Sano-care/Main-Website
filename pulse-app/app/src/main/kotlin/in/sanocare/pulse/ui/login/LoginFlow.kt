package `in`.sanocare.pulse.ui.login

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

// PB1 — login navigation: phone → OTP. Both screens share one hilt-scoped
// AuthViewModel. On verify success, onAuthenticated(isNewCustomer) tells the
// AuthGate whether to route into onboarding (first sign-up) or straight home.

private object Routes {
    const val PHONE = "login/phone"
    const val OTP = "login/otp/{phone}"
    fun otp(phone: String) = "login/otp/$phone"
}

@Composable
fun LoginFlow(
    onAuthenticated: (isNewCustomer: Boolean) -> Unit,
) {
    val navController = rememberNavController()
    val vm: AuthViewModel = hiltViewModel()
    val state by vm.state.collectAsState()

    NavHost(navController = navController, startDestination = Routes.PHONE) {
        composable(Routes.PHONE) {
            LoginScreen(
                sending = state.sending,
                errorMessage = state.errorMessage,
                onContinue = { phone ->
                    vm.sendOtp(phone) { navController.navigate(Routes.otp(phone)) }
                },
            )
        }
        composable(Routes.OTP) { backStackEntry ->
            val phone = backStackEntry.arguments?.getString("phone").orEmpty()
            OtpScreen(
                phone = phone,
                verifying = state.verifying,
                errorMessage = state.errorMessage,
                medicNumber = state.medicNumber,
                resendSeconds = state.resendSeconds,
                onBack = {
                    vm.clearTransient()
                    navController.popBackStack()
                },
                onVerify = { otp -> vm.verifyOtp(phone, otp) { isNew -> onAuthenticated(isNew) } },
                onResend = { vm.resend(phone) },
            )
        }
    }
}
