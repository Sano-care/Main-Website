package `in`.sanocare.medic.ui.login

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
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
    verifying: Boolean,
    errorMessage: String?,
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
            isError = errorMessage != null,
            modifier = Modifier.fillMaxWidth(),
        )
        if (errorMessage != null) {
            Text(
                text = errorMessage,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
        Button(
            onClick = { onVerify(otp) },
            enabled = otp.length == 6 && !verifying,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
        ) {
            if (verifying) {
                CircularProgressIndicator(
                    modifier = Modifier.height(24.dp),
                    strokeWidth = 2.dp,
                )
            } else {
                Text(stringResource(R.string.login_otp_cta))
            }
        }
        TextButton(onClick = onBack) {
            Text(stringResource(R.string.login_otp_back))
        }
    }
}
