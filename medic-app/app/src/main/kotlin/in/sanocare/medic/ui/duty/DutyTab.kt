package `in`.sanocare.medic.ui.duty

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import `in`.sanocare.medic.R

// T65 Phase 1 C3 — Duty tab placeholder. C4 replaces this with the
// AttendanceScreen (clock in/out + location capture).

@Composable
fun DutyTab() {
    Box(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = stringResource(R.string.duty_placeholder),
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}
