package `in`.sanocare.pulse.ui.onboarding

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.border
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import `in`.sanocare.pulse.R
import `in`.sanocare.pulse.theme.BorderHair
import `in`.sanocare.pulse.theme.InkPrimary
import `in`.sanocare.pulse.theme.InkSecondary
import `in`.sanocare.pulse.theme.Paper
import `in`.sanocare.pulse.theme.SanocareBlue
import `in`.sanocare.pulse.ui.components.GhostButton
import `in`.sanocare.pulse.ui.components.PrimaryButton
import `in`.sanocare.pulse.ui.components.SanocareLockup

// PB1 — first sign-up onboarding. Step 1: stay-signed-in consent (default on).
// Step 2: add-family (skippable). Returning users skip this entirely (gated in
// AuthGate on is_new_customer + the local onboarding_done flag).
//
// Note (edge case 2): the bearer session is non-expiring / revoke-only, so the
// stay-signed-in switch is a consent surface in PB1 — it does not shorten the
// session. Kept for parity with the web onboarding + future device management.

@Composable
fun OnboardingFlow(onFinish: () -> Unit) {
    var step by rememberSaveable { mutableStateOf(1) }
    var staySignedIn by rememberSaveable { mutableStateOf(true) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(horizontal = 24.dp),
    ) {
        Spacer(Modifier.height(24.dp))
        SanocareLockup(markSize = 26.dp, wordmarkSp = 19)
        Spacer(Modifier.height(36.dp))

        if (step == 1) {
            Text(
                text = stringResource(R.string.onboarding_stay_title),
                style = MaterialTheme.typography.headlineMedium,
                color = InkPrimary,
            )
            Spacer(Modifier.height(12.dp))
            Text(
                text = stringResource(R.string.onboarding_stay_body),
                style = MaterialTheme.typography.bodyLarge,
                color = InkSecondary,
            )
            Spacer(Modifier.height(24.dp))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .border(1.dp, BorderHair, RoundedCornerShape(14.dp))
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
                Text(
                    text = stringResource(R.string.onboarding_stay_toggle),
                    color = InkPrimary,
                    fontSize = 15.sp,
                    modifier = Modifier.weight(1f),
                )
                Switch(
                    checked = staySignedIn,
                    onCheckedChange = { staySignedIn = it },
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = Paper,
                        checkedTrackColor = SanocareBlue,
                    ),
                )
            }

            Spacer(Modifier.weight(1f))
            PrimaryButton(
                text = stringResource(R.string.onboarding_continue),
                onClick = { step = 2 },
            )
            Spacer(Modifier.height(20.dp))
        } else {
            Text(
                text = stringResource(R.string.onboarding_family_title),
                style = MaterialTheme.typography.headlineMedium,
                color = InkPrimary,
            )
            Spacer(Modifier.height(12.dp))
            Text(
                text = stringResource(R.string.onboarding_family_body),
                style = MaterialTheme.typography.bodyLarge,
                color = InkSecondary,
            )

            Spacer(Modifier.weight(1f))
            // Add-family UI lands in a later slice; in PB1 both paths complete
            // onboarding. Family management is reachable from the drawer.
            PrimaryButton(
                text = stringResource(R.string.onboarding_family_add),
                onClick = onFinish,
            )
            Spacer(Modifier.height(10.dp))
            GhostButton(
                text = stringResource(R.string.onboarding_family_skip),
                onClick = onFinish,
            )
            Spacer(Modifier.height(20.dp))
        }
    }
}
