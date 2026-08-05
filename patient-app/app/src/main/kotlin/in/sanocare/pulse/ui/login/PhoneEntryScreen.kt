package `in`.sanocare.pulse.ui.login

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import `in`.sanocare.pulse.theme.InkMute
import `in`.sanocare.pulse.theme.InkSecondary
import `in`.sanocare.pulse.theme.SanocareBlue

// Phase 0 shell — UI only. "Send code on WhatsApp" advances to the OTP screen
// (no /api/auth/send-otp call yet; Phase 1 wires it). Open signup: any phone
// can register — no medic:true flag, no closed-signup pre-check.
@Composable
fun PhoneEntryScreen(
    phone: String,
    onPhoneChange: (String) -> Unit,
    onSubmit: () -> Unit,
    contentPadding: PaddingValues = PaddingValues(),
) {
    var consent by rememberSaveable { mutableStateOf(false) }
    val isValid = remember(phone, consent) { phone.length == 10 && consent }

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
            text = "Your health, in one place",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text =
                "We'll send a 6-digit code by WhatsApp. Your mobile number is all we need " +
                    "— no password to remember.",
            style = MaterialTheme.typography.bodyMedium,
            color = InkSecondary,
        )

        Spacer(Modifier.height(28.dp))

        OutlinedTextField(
            value = phone,
            onValueChange = { input -> onPhoneChange(input.filter { it.isDigit() }.take(10)) },
            label = { Text("Mobile number") },
            prefix = { Text("+91 ") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(20.dp))

        Row(verticalAlignment = Alignment.Top) {
            Checkbox(checked = consent, onCheckedChange = { consent = it })
            Spacer(Modifier.width(4.dp))
            Text(
                text =
                    "I agree to receive a one-time verification code from Sanocare on this " +
                        "number, and to Sanocare processing my data per the Privacy Policy.",
                style = MaterialTheme.typography.bodySmall,
                color = InkSecondary,
                modifier = Modifier.padding(top = 14.dp),
            )
        }

        Spacer(Modifier.height(28.dp))

        Button(
            onClick = onSubmit,
            enabled = isValid,
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) {
            Text("Send code on WhatsApp")
        }

        Spacer(Modifier.height(24.dp))

        Text(
            text = "Need help? Call us at +91 97119 77782.",
            style = MaterialTheme.typography.bodySmall,
            color = InkMute,
        )
    }
}

// Phase 0 text lockup: "Sanocare" wordmark + small "PULSE" treatment, matching
// the web /pulse/login header. The canonical lockup SVG swaps in as a drawable
// in a Phase 0.1 polish pass (keeps Phase 0 dependency-free — no Coil).
@Composable
internal fun PulseLockup() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = "Sanocare",
            color = SanocareBlue,
            fontWeight = FontWeight.Bold,
            fontSize = 24.sp,
        )
        Spacer(Modifier.width(8.dp))
        Text(
            text = "PULSE",
            color = InkMute,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Medium,
            fontSize = 13.sp,
            letterSpacing = 2.sp,
        )
    }
}
