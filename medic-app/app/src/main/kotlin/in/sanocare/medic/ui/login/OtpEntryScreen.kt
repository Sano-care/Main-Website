package `in`.sanocare.medic.ui.login

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import `in`.sanocare.medic.R

@Composable
fun OtpEntryScreen(
    phone: String,
    contentPadding: PaddingValues,
    onBack: () -> Unit,
    onVerify: (String) -> Unit,
) {
    var otp by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding)
            .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            text = stringResource(R.string.login_otp_title),
            style = MaterialTheme.typography.headlineLarge,
        )
        Text(
            // Phase 0: shows the phone the user just entered so the back-flow
            // is unambiguous. Phase 1 prefixes with +91 once a phone-formatting
            // util lives in the shared lib.
            text = stringResource(R.string.login_otp_subtitle) + "\n+91 $phone",
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(modifier = Modifier.height(8.dp))
        OutlinedTextField(
            value = otp,
            onValueChange = { input -> otp = input.filter { it.isDigit() }.take(6) },
            label = { Text(stringResource(R.string.login_otp_input_label)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            singleLine = true,
            modifier = Modifier.fillMaxSize().height(72.dp),
        )
        Button(
            onClick = { onVerify(otp) },
            enabled = otp.length == 6,
            modifier = Modifier.fillMaxSize().height(56.dp),
        ) {
            Text(stringResource(R.string.login_otp_cta))
        }
        TextButton(onClick = onBack) {
            Text(stringResource(R.string.login_otp_back))
        }
    }
}
