package `in`.sanocare.medic.ui.login

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import `in`.sanocare.medic.data.auth.CachedProfile

// CachedProfile import retained even when unused-as-receiver because the
// onAuthenticated lambda's parameter type is referenced in this file.

// T65 Phase 1 — login navigation shell. Phone → OTP. Both screens share a
// single hilt-scoped AuthViewModel so verify-otp success can call
// onAuthenticated with the CachedProfile that came back from the server.

private object Routes {
    const val PHONE = "login/phone"
    const val OTP = "login/otp/{phone}"
    fun otp(phone: String) = "login/otp/$phone"
}

@Composable
fun LoginFlow(
    contentPadding: PaddingValues,
    onAuthenticated: (CachedProfile) -> Unit,
) {
    val navController = rememberNavController()
    val vm: AuthViewModel = hiltViewModel()
    val state by vm.state.collectAsState()

    NavHost(
        navController = navController,
        startDestination = Routes.PHONE,
    ) {
        composable(Routes.PHONE) {
            PhoneEntryScreen(
                contentPadding = contentPadding,
                sending = state.sending,
                errorMessage = state.errorMessage,
                onSendOtp = { phone ->
                    vm.sendOtp(phone) {
                        vm.clearError()
                        navController.navigate(Routes.otp(phone))
                    }
                },
            )
        }
        composable(Routes.OTP) { backStackEntry ->
            val phone = backStackEntry.arguments?.getString("phone").orEmpty()
            OtpEntryScreen(
                phone = phone,
                contentPadding = contentPadding,
                verifying = state.verifying,
                errorMessage = state.errorMessage,
                onBack = {
                    vm.clearError()
                    navController.popBackStack()
                },
                onVerify = { otp ->
                    vm.verifyOtp(phone, otp) { profile ->
                        onAuthenticated(profile)
                    }
                },
            )
        }
    }
}
