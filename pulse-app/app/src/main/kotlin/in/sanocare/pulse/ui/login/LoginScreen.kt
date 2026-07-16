package `in`.sanocare.pulse.ui.login

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import `in`.sanocare.pulse.R
import `in`.sanocare.pulse.theme.InkMute
import `in`.sanocare.pulse.theme.InkPrimary
import `in`.sanocare.pulse.theme.InkSecondary
import `in`.sanocare.pulse.ui.components.PhoneField
import `in`.sanocare.pulse.ui.components.PrimaryButton
import `in`.sanocare.pulse.ui.components.SanocareLockup

// Concept A — calm clinical / quiet white. Lockup top-left, headline, sub,
// single +91 phone field, a trust line, and a low-pinned Continue with a tiny
// terms line. House voice: no exclamations, no "just one tap", no "24/7".

@Composable
fun LoginScreen(
    sending: Boolean,
    errorMessage: String?,
    onContinue: (phone: String) -> Unit,
) {
    var phone by rememberSaveable { mutableStateOf("") }
    var focused by remember { mutableStateOf(false) }
    val valid = phone.length == 10

    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
            .padding(horizontal = 24.dp),
    ) {
        Spacer(Modifier.height(24.dp))
        SanocareLockup(markSize = 30.dp, wordmarkSp = 22)

        Spacer(Modifier.height(40.dp))
        Text(
            text = stringResource(R.string.login_headline),
            style = MaterialTheme.typography.headlineLarge,
            color = InkPrimary,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = stringResource(R.string.login_sub),
            style = MaterialTheme.typography.bodyLarge,
            color = InkSecondary,
        )

        Spacer(Modifier.height(28.dp))
        PhoneField(
            value = phone,
            onValueChange = { phone = it },
            hint = stringResource(R.string.login_phone_hint),
            focused = focused,
            onFocusChanged = { focused = it },
        )

        if (errorMessage != null) {
            Spacer(Modifier.height(10.dp))
            Text(text = errorMessage, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
        }

        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = Icons.Outlined.Shield,
                contentDescription = null,
                tint = InkMute,
                modifier = Modifier.width(16.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = stringResource(R.string.login_trust),
                color = InkMute,
                fontSize = 12.sp,
                lineHeight = 16.sp,
            )
        }

        // Pin the CTA low.
        Spacer(Modifier.weight(1f))

        PrimaryButton(
            text = stringResource(R.string.login_cta),
            onClick = { onContinue(phone) },
            enabled = valid,
            loading = sending,
        )
        Spacer(Modifier.height(10.dp))
        Text(
            text = stringResource(R.string.login_terms),
            color = InkMute,
            fontSize = 11.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
        )
        Spacer(Modifier.height(20.dp))
    }
}
