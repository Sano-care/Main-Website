package `in`.sanocare.medic.ui.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.AccessTime
import androidx.compose.material.icons.outlined.AttachMoney
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import `in`.sanocare.medic.R
import `in`.sanocare.medic.data.auth.CachedProfile
import `in`.sanocare.medic.ui.duty.DutyTab

// T65 Phase 1 — MainShell. Three tabs (Duty / Payouts / Me) wrapped in a
// Scaffold with a top bar showing the signed-in medic's name. Phase 1 only
// fills out the Duty tab (Attendance). Payouts + Me are placeholders for
// Phase 2 / general polish.

private enum class Tab(
    val labelRes: Int,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
) {
    Duty(R.string.tab_duty, Icons.Outlined.AccessTime),
    Payouts(R.string.tab_payouts, Icons.Outlined.AttachMoney),
    Me(R.string.tab_me, Icons.Outlined.AccountCircle),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainShell(
    profile: CachedProfile,
    contentPadding: PaddingValues,
    onSignOut: () -> Unit,
) {
    var selected by remember { mutableStateOf(Tab.Duty) }

    Scaffold(
        modifier = Modifier.fillMaxSize().padding(contentPadding),
        topBar = {
            TopAppBar(title = {
                Column {
                    Text(
                        text = stringResource(R.string.shell_title),
                        style = MaterialTheme.typography.titleLarge,
                    )
                    Text(
                        text = profile.fullName,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            })
        },
        bottomBar = {
            NavigationBar {
                Tab.entries.forEach { tab ->
                    NavigationBarItem(
                        selected = selected == tab,
                        onClick = { selected = tab },
                        icon = { Icon(tab.icon, contentDescription = null) },
                        label = { Text(stringResource(tab.labelRes)) },
                    )
                }
            }
        },
    ) { inner ->
        Box(modifier = Modifier.fillMaxSize().padding(inner)) {
            when (selected) {
                Tab.Duty -> DutyTab()
                Tab.Payouts -> PlaceholderTab(stringResource(R.string.tab_payouts_placeholder))
                Tab.Me -> MeTab(profile = profile, onSignOut = onSignOut)
            }
        }
    }
}

@Composable
private fun PlaceholderTab(body: String) {
    Box(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text = body, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun MeTab(profile: CachedProfile, onSignOut: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = profile.fullName,
            style = MaterialTheme.typography.headlineSmall,
        )
        Text(
            text = profile.qualification,
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(modifier = Modifier.height(24.dp))
        TextButton(onClick = onSignOut) {
            Text(stringResource(R.string.me_sign_out))
        }
    }
}
