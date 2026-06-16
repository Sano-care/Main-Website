package `in`.sanocare.medic.ui.duty

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import `in`.sanocare.medic.R
import `in`.sanocare.medic.data.network.AttendanceRow

// T65 Phase 1 C4 — AttendanceScreen. Three states:
//  - Loading (initial GET)
//  - Clocked out (no open row) → big "Clock in" button
//  - Clocked in (open row) → shows clock-in time + "Clock out" button
//
// Location permission is requested on first clock-in attempt via the
// rememberLauncherForActivityResult API. Denial → null coords sent (the
// server accepts null and the route still completes).

@Composable
fun AttendanceScreen() {
    val vm: AttendanceViewModel = hiltViewModel()
    val state by vm.state.collectAsState()

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions(),
    ) { _ ->
        // Outcome doesn't matter — VM re-checks permission inside
        // LocationProvider.current() and falls back to null lat/lng on
        // denial. We just unblock the clock-in click flow.
        vm.clockIn()
    }

    val requestPermissions = remember(permissionLauncher) {
        {
            permissionLauncher.launch(
                arrayOf(
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                    Manifest.permission.ACCESS_FINE_LOCATION,
                ),
            )
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 32.dp),
    ) {
        when {
            state.loading -> Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }
            state.openRow != null -> ClockedInBody(
                row = state.openRow!!,
                acting = state.acting,
                errorMessage = state.errorMessage,
                onClockOut = vm::clockOut,
            )
            else -> ClockedOutBody(
                acting = state.acting,
                errorMessage = state.errorMessage,
                onClockIn = {
                    if (!hasLocationConsentSurfaceable(state.openRow)) {
                        requestPermissions()
                    } else {
                        vm.clockIn()
                    }
                },
            )
        }
    }
}

@Composable
private fun ClockedOutBody(
    acting: Boolean,
    errorMessage: String?,
    onClockIn: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(modifier = Modifier.height(40.dp))
        Text(
            text = stringResource(R.string.attendance_clocked_out_title),
            style = MaterialTheme.typography.headlineSmall,
        )
        Text(
            text = stringResource(R.string.attendance_clocked_out_subtitle),
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(modifier = Modifier.height(24.dp))
        Button(
            onClick = onClockIn,
            enabled = !acting,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
        ) {
            if (acting) {
                CircularProgressIndicator(
                    modifier = Modifier.height(24.dp),
                    strokeWidth = 2.dp,
                )
            } else {
                Text(stringResource(R.string.attendance_clock_in_cta))
            }
        }
        if (errorMessage != null) {
            Text(
                text = errorMessage,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

@Composable
private fun ClockedInBody(
    row: AttendanceRow,
    acting: Boolean,
    errorMessage: String?,
    onClockOut: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(modifier = Modifier.height(40.dp))
        Text(
            text = stringResource(R.string.attendance_clocked_in_title),
            style = MaterialTheme.typography.headlineSmall,
        )
        Text(
            text = stringResource(
                R.string.attendance_clocked_in_since,
                formatTimestamp(row.clockInAt),
            ),
            style = MaterialTheme.typography.bodyMedium,
        )
        if (row.clockInLat != null && row.clockInLng != null) {
            Text(
                text = stringResource(
                    R.string.attendance_clocked_in_coords,
                    row.clockInLat,
                    row.clockInLng,
                ),
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Spacer(modifier = Modifier.height(24.dp))
        Button(
            onClick = onClockOut,
            enabled = !acting,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
        ) {
            if (acting) {
                CircularProgressIndicator(
                    modifier = Modifier.height(24.dp),
                    strokeWidth = 2.dp,
                )
            } else {
                Text(stringResource(R.string.attendance_clock_out_cta))
            }
        }
        if (errorMessage != null) {
            Text(
                text = errorMessage,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

private fun hasLocationConsentSurfaceable(@Suppress("UNUSED_PARAMETER") openRow: AttendanceRow?): Boolean {
    // Always request — the OS dedupes if already granted. Cheaper than
    // wiring a `getCurrentPermissionState` flow at v0. The permission
    // launcher's launch() returns instantly with the cached grant when
    // there's nothing to prompt.
    return false
}

private fun formatTimestamp(iso: String): String {
    // ISO 8601 → HH:mm display. Cheap substring rather than dragging in a
    // formatter: the server emits e.g. "2026-06-16T08:42:11.234Z".
    val tIdx = iso.indexOf('T')
    if (tIdx < 0) return iso
    val time = iso.substring(tIdx + 1, minOf(tIdx + 6, iso.length))
    return time
}
