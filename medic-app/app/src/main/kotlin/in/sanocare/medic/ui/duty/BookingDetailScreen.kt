package `in`.sanocare.medic.ui.duty

import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import `in`.sanocare.medic.data.network.BookingDto
import kotlinx.coroutines.launch
import java.net.URLEncoder

// T65 Phase 2 C7 — BookingDetailScreen.
//
// Patient block (tap-to-dial) · address block (Open in Maps) · service info ·
// 4 sequential locked event buttons (departed → reached → visit_started →
// visit_done). Each tap: disable → best-effort single-shot location → POST
// event. Success collapses the button to "✓ <done> at HH:MM IST" and unlocks
// the next. Network failure → snackbar "Couldn't record event, tap to
// retry". 401 → onSignOut() (redirect to login). visit_done → toast.

private val ACTION_LABEL = mapOf(
    "departed" to "I've departed",
    "reached" to "I've reached patient",
    "visit_started" to "Start consult",
    "visit_done" to "Visit complete",
)
private val DONE_LABEL = mapOf(
    "departed" to "Departed",
    "reached" to "Reached patient",
    "visit_started" to "Consult started",
    "visit_done" to "Visit completed",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BookingDetailScreen(
    booking: BookingDto,
    onBack: () -> Unit,
    onUnauthorized: () -> Unit,
) {
    val vm: BookingDetailViewModel = hiltViewModel()
    val state by vm.state.collectAsState()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(booking.id) { vm.seed(booking.events) }

    LaunchedEffect(vm) {
        vm.effects.collect { effect ->
            when (effect) {
                BookingDetailEffect.VisitDone ->
                    Toast.makeText(
                        context,
                        "Visit logged. Stay clocked in for next visit.",
                        Toast.LENGTH_LONG,
                    ).show()
                BookingDetailEffect.Unauthorized -> onUnauthorized()
                is BookingDetailEffect.Failure -> {
                    scope.launch {
                        val result = snackbarHostState.showSnackbar(
                            message = "Couldn't record event, tap to retry",
                            actionLabel = "Retry",
                        )
                        if (result == SnackbarResult.ActionPerformed) {
                            vm.fireEvent(booking.id, effect.event)
                        }
                    }
                }
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(booking.bookingCode ?: "Visit") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { inner ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(inner)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            PatientBlock(booking, context)
            AddressBlock(booking, context)
            ServiceBlock(booking)

            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                EVENT_ORDER.forEachIndexed { index, event ->
                    val recordedAt = state.recordedAt[event]
                    val priorDone =
                        index == 0 || state.recordedAt.containsKey(EVENT_ORDER[index - 1])
                    EventButton(
                        actionLabel = ACTION_LABEL.getValue(event),
                        doneLabel = DONE_LABEL.getValue(event),
                        recordedAtIso = recordedAt,
                        firing = state.firing == event,
                        enabled = priorDone && state.firing == null,
                        onClick = { vm.fireEvent(booking.id, event) },
                    )
                }
            }
        }
    }
}

@Composable
private fun PatientBlock(booking: BookingDto, context: android.content.Context) {
    DetailCard {
        Text(
            text = booking.patientName?.takeIf { it.isNotBlank() } ?: "Patient",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
        )
        if (!booking.bookingCode.isNullOrBlank()) {
            Text(
                text = booking.bookingCode,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.outline,
            )
        }
        val phone = booking.phone
        if (!phone.isNullOrBlank()) {
            OutlinedButton(
                onClick = {
                    context.startActivity(
                        Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone")),
                    )
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Filled.Call, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("  Call $phone")
            }
        }
    }
}

@Composable
private fun AddressBlock(booking: BookingDto, context: android.content.Context) {
    val address = booking.manualAddress?.takeIf { it.isNotBlank() }
    val gps = booking.gpsLocation
    if (address == null && gps == null) return
    DetailCard {
        Text(
            text = "Address",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.outline,
        )
        Text(
            text = address ?: "Location pin attached",
            style = MaterialTheme.typography.bodyMedium,
        )
        OutlinedButton(
            onClick = {
                val q = URLEncoder.encode(address ?: "", "UTF-8")
                // With a GPS pin, anchor the map there + label with the
                // address; without one, fall back to a query-only geo URI.
                val uri = if (gps != null) "geo:${gps.lat},${gps.lng}?q=$q"
                else "geo:0,0?q=$q"
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri)))
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Icon(Icons.Filled.Place, contentDescription = null, modifier = Modifier.size(18.dp))
            Text("  Open in Maps")
        }
    }
}

@Composable
private fun ServiceBlock(booking: BookingDto) {
    DetailCard {
        Text(
            text = "Service",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.outline,
        )
        Text(
            text = serviceLabel(booking.serviceCategory),
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = if (booking.scheduledFor.isNullOrBlank()) "ASAP"
            else formatIstDateTime(booking.scheduledFor),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun EventButton(
    actionLabel: String,
    doneLabel: String,
    recordedAtIso: String?,
    firing: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    if (recordedAtIso != null) {
        // Collapsed, completed state.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Filled.Check,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(20.dp),
            )
            Text(
                text = "  $doneLabel at ${formatIstTime(recordedAtIso)}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    } else {
        Button(
            onClick = onClick,
            enabled = enabled && !firing,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
        ) {
            if (firing) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                )
            } else {
                Text(actionLabel)
            }
        }
    }
}

@Composable
private fun DetailCard(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            content = content,
        )
    }
}
