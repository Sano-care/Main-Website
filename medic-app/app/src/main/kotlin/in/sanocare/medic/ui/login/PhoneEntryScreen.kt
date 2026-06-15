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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
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
fun PhoneEntryScreen(
    contentPadding: PaddingValues,
    onSendOtp: (String) -> Unit,
) {
    var phone by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding)
            .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            text = stringResource(R.string.login_phone_title),
            style = androidx.compose.material3.MaterialTheme.typography.headlineLarge,
        )
        Text(
            text = stringResource(R.string.login_phone_subtitle),
            style = androidx.compose.material3.MaterialTheme.typography.bodyMedium,
        )
        Spacer(modifier = Modifier.height(8.dp))
        OutlinedTextField(
            value = phone,
            onValueChange = { input ->
                // Only digits, max 10 (Indian mobile).
                phone = input.filter { it.isDigit() }.take(10)
            },
            label = { Text(stringResource(R.string.login_phone_input_label)) },
            placeholder = { Text(stringResource(R.string.login_phone_input_hint)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            singleLine = true,
            modifier = Modifier.fillMaxSize().height(72.dp),
        )
        Button(
            onClick = { onSendOtp(phone) },
            enabled = phone.length == 10,
            modifier = Modifier.fillMaxSize().height(56.dp),
        ) {
            Text(stringResource(R.string.login_phone_cta))
        }
    }
}
