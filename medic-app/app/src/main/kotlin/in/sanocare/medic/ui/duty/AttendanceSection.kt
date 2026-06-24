package `in`.sanocare.medic.ui.duty

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import `in`.sanocare.medic.attendance.MedicAttendanceService

private const val TAG = "AttendanceSection"

// T65 Phase 2 C6 — compact attendance card for the top of the Duty tab.
//
// Same stateful logic as the Phase 1.5 AttendanceScreen (permission ask
// sequence, foreground-service start/stop dispatch via vm.events, clock
// in/out) — only the rendering changed from a full-screen body to a compact
// card so the visit roster can live below it on the same tab. The
// POST_NOTIFICATIONS hard gate + location soft-degrade behaviour is
// preserved verbatim.

@Composable
fun AttendanceSection(modifier: Modifier = Modifier) {
    val vm: AttendanceViewModel = hiltViewModel()
    val state by vm.state.collectAsState()
    val context = LocalContext.current

    LaunchedEffect(Unit) {
        vm.events.collect { event ->
            val intent = Intent(context, MedicAttendanceService::class.java)
            when (event) {
                AttendanceEvent.StartTracking ->
                    ContextCompat.startForegroundService(context, intent)
                AttendanceEvent.StopTracking ->
                    context.stopService(intent)
            }
        }
    }

    // Re-sync attendance state to the currently signed-in medic on every mount
    // (first sign-in AND re-entry after an account switch — this VM is
    // activity-scoped and survives sign-out, so without this it would show the
    // previous medic's state). #88 account-switch fix.
    LaunchedEffect(Unit) { vm.refresh() }

    val requiredPermissions = remember {
        MedicAttendanceService.requiredRuntimePermissions()
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions(),
    ) { results ->
        val notificationsOk =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                results[Manifest.permission.POST_NOTIFICATIONS] == true
        if (!notificationsOk) {
            Log.w(TAG, "POST_NOTIFICATIONS denied — blocking clock-in")
            vm.setError(
                "Notifications are required to track your shift. " +
                    "Enable Sanocare Medic notifications in Settings.",
            )
            return@rememberLauncherForActivityResult
        }
        // Location: soft-degrade on denial (clock-in still inserts with null
        // coords; the service simply pings nothing).
        vm.clockIn()
    }

    val requestPermissionsOrClockIn = remember(context, permissionLauncher) {
        {
            val allGranted = requiredPermissions.all { perm ->
                ContextCompat.checkSelfPermission(context, perm) ==
                    PackageManager.PERMISSION_GRANTED
            }
            if (allGranted) vm.clockIn()
            else permissionLauncher.launch(requiredPermissions)
        }
    }

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val onDuty = state.openRow != null
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    shape = CircleShape,
                    color = if (onDuty) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.outlineVariant,
                    modifier = Modifier.size(10.dp),
                ) {}
                Text(
                    text = if (onDuty) "On duty" else "Off duty",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(start = 8.dp),
                )
                if (onDuty && state.openRow != null) {
                    Text(
                        text = "  ·  since ${formatIstTime(state.openRow!!.clockInAt)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            if (state.loading && state.openRow == null) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                )
            } else if (onDuty) {
                OutlinedButton(
                    onClick = vm::clockOut,
                    enabled = !state.acting,
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                ) {
                    ButtonLabel(acting = state.acting, label = "Clock out")
                }
            } else {
                Button(
                    onClick = requestPermissionsOrClockIn,
                    enabled = !state.acting,
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                ) {
                    ButtonLabel(acting = state.acting, label = "Clock in")
                }
            }

            state.errorMessage?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }

            // Medic payroll — post-clock-in selfie nudge. Set from the clock_in
            // response; the daily wage only posts once ops/Aarogya verify the
            // selfie, so we prompt the medic to send it on WhatsApp now.
            state.selfiePrompt?.let { prompt ->
                Surface(
                    color = MaterialTheme.colorScheme.primaryContainer,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(
                        modifier = Modifier.padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            text = prompt.message,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                        )
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Button(onClick = {
                                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(prompt.waUrl))
                                runCatching { context.startActivity(intent) }
                                    .onFailure { Log.w(TAG, "Could not open WhatsApp", it) }
                                vm.dismissSelfiePrompt()
                            }) {
                                Text("Send selfie on WhatsApp")
                            }
                            TextButton(onClick = vm::dismissSelfiePrompt) {
                                Text("Later")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ButtonLabel(acting: Boolean, label: String) {
    if (acting) {
        CircularProgressIndicator(
            modifier = Modifier.size(20.dp),
            strokeWidth = 2.dp,
        )
    } else {
        Text(label)
    }
}
