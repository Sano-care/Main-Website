package `in`.sanocare.pulse.ui.login

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import `in`.sanocare.pulse.theme.InkMute
import `in`.sanocare.pulse.theme.InkSecondary

// Phase 0 shell — UI only. "Verify" is a no-op for now (Phase 1 calls
// /api/auth/verify-otp + mints the sanocare_otp_verify session). "Use a
// different number" returns to PhoneEntryScreen.
@Composable
fun OtpEntryScreen(
    phone: String,
    onBack: () -> Unit,
    onVerify: () -> Unit,
    contentPadding: PaddingValues = PaddingValues(),
) {
    var code by rememberSaveable { mutableStateOf("") }
    val masked = remember(phone) { formatPhone(phone) }
    val isValid = code.length == 6

    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .padding(contentPadding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 32.dp),
    ) {
        PulseLockup()

        Spacer(Modifier.height(40.dp))

        Text(
            text = "Enter verification code",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = "Sent to $masked. The code may take a moment to arrive.",
            style = MaterialTheme.typography.bodyMedium,
            color = InkSecondary,
        )

        Spacer(Modifier.height(28.dp))

        OutlinedTextField(
            value = code,
            onValueChange = { input -> code = input.filter { it.isDigit() }.take(6) },
            label = { Text("6-digit code") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(28.dp))

        Button(
            onClick = onVerify,
            enabled = isValid,
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) {
            Text("Verify")
        }

        Spacer(Modifier.height(8.dp))

        TextButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) {
            Text("Use a different number")
        }

        Spacer(Modifier.height(16.dp))

        Text(
            text = "Need help? Call us at +91 97119 77782.",
            style = MaterialTheme.typography.bodySmall,
            color = InkMute,
        )
    }
}

// "+91 XXXXX XXXXX" from a 10-digit string; falls back to the +91 prefix for
// partial input (Phase 0 always passes a full 10-digit number).
private fun formatPhone(phone: String): String =
    if (phone.length == 10) "+91 ${phone.substring(0, 5)} ${phone.substring(5)}" else "+91 $phone"
