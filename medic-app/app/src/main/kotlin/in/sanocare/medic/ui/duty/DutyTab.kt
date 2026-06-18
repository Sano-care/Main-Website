package `in`.sanocare.medic.ui.duty

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import `in`.sanocare.medic.data.network.BookingDto

// T65 Phase 2 C6 — Duty tab. Hosts the compact attendance card + the day's
// visit roster (pull-to-refresh) and routes into BookingDetailScreen on a
// card tap. Detail nav is a simple in-tab state hoist (no NavHost needed for
// one push); on a 401 from the detail screen we sign out (→ login).

@Composable
fun DutyTab(onSignOut: () -> Unit) {
    var openBooking by remember { mutableStateOf<BookingDto?>(null) }
    val current = openBooking

    if (current != null) {
        BookingDetailScreen(
            booking = current,
            onBack = { openBooking = null },
            onUnauthorized = {
                openBooking = null
                onSignOut()
            },
        )
    } else {
        DutyHome(onOpenBooking = { openBooking = it })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DutyHome(onOpenBooking: (BookingDto) -> Unit) {
    val vm: DutyViewModel = hiltViewModel()
    val state by vm.state.collectAsState()
    val refreshing by vm.refreshing.collectAsState()

    // First load + tab-focus reload. Re-fires whenever DutyHome re-enters
    // composition (i.e. on return from a BookingDetailScreen), so status
    // chips reflect any events just recorded.
    LaunchedEffect(Unit) { vm.refresh() }

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = vm::refresh,
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { AttendanceSection() }
            item {
                Text(
                    text = "Today's visits",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }

            when (val s = state) {
                DutyState.Loading -> item {
                    Box(
                        modifier = Modifier.fillMaxWidth().padding(32.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator()
                    }
                }
                is DutyState.Error -> item {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text(
                            text = s.message,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.error,
                            textAlign = TextAlign.Center,
                        )
                        OutlinedButton(onClick = vm::refresh) { Text("Retry") }
                    }
                }
                is DutyState.Success -> {
                    if (s.bookings.isEmpty()) {
                        item {
                            Box(
                                modifier = Modifier.fillMaxWidth().padding(32.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    text = "No bookings assigned today",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    } else {
                        items(s.bookings, key = { it.id }) { booking ->
                            BookingCard(
                                booking = booking,
                                onClick = { onOpenBooking(booking) },
                            )
                        }
                    }
                }
            }
        }
    }
}
