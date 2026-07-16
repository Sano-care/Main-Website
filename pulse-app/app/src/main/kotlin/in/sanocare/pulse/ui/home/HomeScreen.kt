package `in`.sanocare.pulse.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.HealthAndSafety
import androidx.compose.material.icons.outlined.MedicalServices
import androidx.compose.material.icons.outlined.Science
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import `in`.sanocare.pulse.R
import `in`.sanocare.pulse.theme.InkMute
import `in`.sanocare.pulse.theme.InkPrimary
import `in`.sanocare.pulse.ui.components.EmergencyRibbon
import `in`.sanocare.pulse.ui.components.OutcomeTile
import `in`.sanocare.pulse.ui.components.SnapshotCard
import java.util.Calendar

// PB1 Home — greeting + date, the 4 outcome tiles (static nav stubs; PB2–PB4
// wire the destinations), the single coral emergency ribbon, and empty-state
// vitals/meds snapshot cards.

@Composable
fun HomeScreen(
    firstName: String?,
    onTile: (HomeTile) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp),
    ) {
        Spacer(Modifier.height(12.dp))
        Text(text = todayLine(), color = InkMute, style = MaterialTheme.typography.labelMedium)
        Spacer(Modifier.height(2.dp))
        Text(
            text = greeting(firstName),
            color = InkPrimary,
            style = MaterialTheme.typography.headlineMedium,
        )

        Spacer(Modifier.height(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
            OutcomeTile(
                title = stringResource(R.string.tile_doctor_title),
                subtitle = stringResource(R.string.tile_doctor_sub),
                icon = Icons.Outlined.Videocam,
                onClick = { onTile(HomeTile.DOCTOR) },
                modifier = Modifier.weight(1f),
            )
            OutcomeTile(
                title = stringResource(R.string.tile_lab_title),
                subtitle = stringResource(R.string.tile_lab_sub),
                icon = Icons.Outlined.Science,
                onClick = { onTile(HomeTile.LAB) },
                modifier = Modifier.weight(1f),
            )
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
            OutcomeTile(
                title = stringResource(R.string.tile_care_title),
                subtitle = stringResource(R.string.tile_care_sub),
                icon = Icons.Outlined.HealthAndSafety,
                onClick = { onTile(HomeTile.CARE) },
                modifier = Modifier.weight(1f),
            )
            OutcomeTile(
                title = stringResource(R.string.tile_medic_title),
                subtitle = stringResource(R.string.tile_medic_sub),
                icon = Icons.Outlined.MedicalServices,
                onClick = { onTile(HomeTile.MEDIC) },
                modifier = Modifier.weight(1f),
            )
        }

        Spacer(Modifier.height(16.dp))
        EmergencyRibbon(text = stringResource(R.string.emergency_ribbon))

        Spacer(Modifier.height(16.dp))
        SnapshotCard(
            title = stringResource(R.string.snapshot_vitals_title),
            emptyText = stringResource(R.string.snapshot_vitals_empty),
        )
        Spacer(Modifier.height(12.dp))
        SnapshotCard(
            title = stringResource(R.string.snapshot_meds_title),
            emptyText = stringResource(R.string.snapshot_meds_empty),
        )
        Spacer(Modifier.height(24.dp))
    }
}

enum class HomeTile { DOCTOR, LAB, CARE, MEDIC }

@Composable
private fun greeting(firstName: String?): String {
    val base = when (Calendar.getInstance().get(Calendar.HOUR_OF_DAY)) {
        in 5..11 -> stringResource(R.string.home_greeting_morning)
        in 12..16 -> stringResource(R.string.home_greeting_afternoon)
        else -> stringResource(R.string.home_greeting_evening)
    }
    return if (firstName.isNullOrBlank()) base else "$base, $firstName"
}

private fun todayLine(): String {
    val fmt = java.text.SimpleDateFormat("EEEE, d MMM", java.util.Locale.ENGLISH)
    return fmt.format(java.util.Date())
}
