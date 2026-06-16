package `in`.sanocare.medic.ui.duty

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import android.widget.Toast
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import `in`.sanocare.medic.R
import `in`.sanocare.medic.attendance.MedicAttendanceService
import `in`.sanocare.medic.data.network.AttendanceRow

private const val TAG = "AttendanceScreen"

// T65 Phase 1 C4 + Phase 1.5 — AttendanceScreen.
//
// Phase 1.5 additions:
//  1. Permission ask sequence (POST_NOTIFICATIONS on Android 13+,
//     ACCESS_COARSE/FINE_LOCATION) before first clock-in.
//  2. POST_NOTIFICATIONS gate — denial blocks clock-in AND surfaces a hint
//     ("Notifications required for attendance tracking. Enable in Settings.").
//     This matches founder spec: notification is the legal basis for
//     background tracking; without it the service can't fulfill its purpose.
//  3. Service lifecycle — VM emits AttendanceEvent.Start/Stop on clock
//     success; this screen observes via LaunchedEffect and dispatches
//     ContextCompat.startForegroundService / context.stopService.

@Composable
fun AttendanceScreen() {
    val vm: AttendanceViewModel = hiltViewModel()
    val state by vm.state.collectAsState()
    val context = LocalContext.current

    LaunchedEffect(Unit) {
        Log.i(TAG, "LaunchedEffect: starting collect on vm.events")
        vm.events.collect { event ->
            Log.i(TAG, "Event received: $event")
            val intent = Intent(context, MedicAttendanceService::class.java)
            when (event) {
                AttendanceEvent.StartTracking -> {
                    Log.i(TAG, "Calling ContextCompat.startForegroundService")
                    Toast.makeText(context, "START: foreground service", Toast.LENGTH_SHORT).show()
                    ContextCompat.startForegroundService(context, intent)
                }
                AttendanceEvent.StopTracking -> {
                    Log.i(TAG, "Calling context.stopService")
                    context.stopService(intent)
                }
            }
        }
    }

    val requiredPermissions = remember {
        MedicAttendanceService.requiredRuntimePermissions()
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions(),
    ) { results ->
        // POST_NOTIFICATIONS is the hard gate on Android 13+. Without it, the
        // foreground service notification suppresses + the medic loses the
        // visual "you are being tracked" signal. Block clock-in.
        val notificationsOk =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                results[Manifest.permission.POST_NOTIFICATIONS] == true
        val fineOk = results[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.ACCESS_FINE_LOCATION,
            ) == PackageManager.PERMISSION_GRANTED
        Log.i(
            TAG,
            "Permission result: notif=$notificationsOk fine=$fineOk results=$results",
        )
        if (!notificationsOk) {
            Log.w(TAG, "POST_NOTIFICATIONS denied — blocking clock-in")
            vm.setError(
                "Notifications are required to track your shift. " +
                    "Enable Sanocare Medic notifications in Settings.",
            )
            return@rememberLauncherForActivityResult
        }
        // Location: soft-degrade on denial. The clock-in row still inserts;
        // the foreground service will fail to acquire GPS and ping nothing.
        // Acceptable v0 state.
        vm.clockIn()
    }

    val requestPermissionsOrClockIn = remember(context, permissionLauncher) {
        {
            Toast.makeText(context, "TAP: Clock In", Toast.LENGTH_SHORT).show()
            val perPermState = requiredPermissions.associateWith { perm ->
                ContextCompat.checkSelfPermission(context, perm) ==
                    PackageManager.PERMISSION_GRANTED
            }
            val allGranted = perPermState.values.all { it }
            Log.i(
                TAG,
                "TAP Clock In: sdk=${Build.VERSION.SDK_INT} perms=$perPermState allGranted=$allGranted",
            )
            if (allGranted) {
                Log.i(TAG, "All permissions granted, calling vm.clockIn() directly")
                vm.clockIn()
            } else {
                Log.i(TAG, "Launching permission request for ${requiredPermissions.toList()}")
                permissionLauncher.launch(requiredPermissions)
            }
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
                onClockIn = requestPermissionsOrClockIn,
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

private fun formatTimestamp(iso: String): String {
    // ISO 8601 → HH:mm display. Cheap substring rather than dragging in a
    // formatter: the server emits e.g. "2026-06-16T08:42:11.234Z".
    val tIdx = iso.indexOf('T')
    if (tIdx < 0) return iso
    return iso.substring(tIdx + 1, minOf(tIdx + 6, iso.length))
}
