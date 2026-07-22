package `in`.sanocare.pulse.ui.records

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

// v2 — the "Bookings" bottom-nav tab. Reuses the Records bookings list + detail
// (shared RecordsViewModel, member-scoped). Tab root shows no back arrow.

@Composable
fun BookingsTab(onUnauthorized: () -> Unit, onStartBooking: () -> Unit) {
    val vm: RecordsViewModel = hiltViewModel()
    val state by vm.state.collectAsState()
    val nav = rememberNavController()

    LaunchedEffect(state) { if (state is RecordsUiState.Unauthorized) onUnauthorized() }

    NavHost(navController = nav, startDestination = "list") {
        composable("list") {
            BookingsList(state, vm::reload, onBack = null, onStartBooking = onStartBooking) { nav.navigate("detail/$it") }
        }
        composable("detail/{id}") { entry ->
            BookingDetail(state, entry.arguments?.getString("id").orEmpty()) { nav.popBackStack() }
        }
    }
}
