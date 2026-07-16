package `in`.sanocare.pulse.ui.login

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Info
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import `in`.sanocare.pulse.R
import `in`.sanocare.pulse.theme.InkMute
import `in`.sanocare.pulse.theme.InkPrimary
import `in`.sanocare.pulse.theme.InkSecondary
import `in`.sanocare.pulse.theme.SanocareBlue
import `in`.sanocare.pulse.theme.SanocareCoral
import `in`.sanocare.pulse.theme.SanocareCoralSoft
import `in`.sanocare.pulse.theme.SanocareMonoFamily
import `in`.sanocare.pulse.ui.components.OtpBoxes
import `in`.sanocare.pulse.ui.components.PrimaryButton

@Composable
fun OtpScreen(
    phone: String,
    verifying: Boolean,
    errorMessage: String?,
    medicNumber: Boolean,
    resendSeconds: Int,
    onBack: () -> Unit,
    onVerify: (otp: String) -> Unit,
    onResend: () -> Unit,
) {
    var otp by rememberSaveable { mutableStateOf("") }
    val valid = otp.length == 6

    Column(
        modifier = Modifier
            .fillMaxSize()
            .imePadding()
            .padding(horizontal = 24.dp),
    ) {
        Spacer(Modifier.height(16.dp))
        Icon(
            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
            contentDescription = "Back",
            tint = InkSecondary,
            modifier = Modifier
                .size(28.dp)
                .clickable { onBack() },
        )

        Spacer(Modifier.height(24.dp))
        Text(
            text = stringResource(R.string.otp_title),
            style = MaterialTheme.typography.headlineMedium,
            color = InkPrimary,
        )
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = stringResource(R.string.otp_sent_prefix) + " ",
                color = InkSecondary,
                fontSize = 14.sp,
            )
            Text(
                text = "+91 " + phoneMasked(phone),
                color = InkSecondary,
                fontFamily = SanocareMonoFamily,
                fontSize = 14.sp,
            )
            Text(text = "  ·  ", color = InkMute, fontSize = 14.sp)
            Text(
                text = stringResource(R.string.otp_change),
                color = SanocareBlue,
                fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp,
                modifier = Modifier.clickable { onBack() },
            )
        }

        Spacer(Modifier.height(28.dp))
        OtpBoxes(value = otp, onValueChange = { otp = it })

        Spacer(Modifier.height(12.dp))
        Text(
            text = stringResource(R.string.otp_delivered),
            color = InkMute,
            fontSize = 12.sp,
        )

        if (errorMessage != null) {
            Spacer(Modifier.height(10.dp))
            Text(text = errorMessage, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
        }

        if (medicNumber) {
            Spacer(Modifier.height(14.dp))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(SanocareCoralSoft, RoundedCornerShape(12.dp))
                    .padding(12.dp),
            ) {
                Icon(Icons.Outlined.Info, contentDescription = null, tint = SanocareCoral, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(10.dp))
                Text(
                    text = stringResource(R.string.login_medic_number),
                    color = InkPrimary,
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                )
            }
        }

        Spacer(Modifier.height(20.dp))
        // Resend line — countdown, then a tappable "Resend code".
        if (resendSeconds > 0) {
            Text(
                text = stringResource(R.string.otp_resend_in, formatMmSs(resendSeconds)),
                color = InkMute,
                fontSize = 13.sp,
            )
        } else {
            Text(
                text = stringResource(R.string.otp_resend),
                color = SanocareBlue,
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp,
                modifier = Modifier.clickable { onResend() },
            )
        }

        Spacer(Modifier.weight(1f))

        PrimaryButton(
            text = stringResource(R.string.otp_cta),
            onClick = { onVerify(otp) },
            enabled = valid && !medicNumber,
            loading = verifying,
        )
        Spacer(Modifier.height(20.dp))
    }
}

private fun formatMmSs(totalSeconds: Int): String {
    val m = totalSeconds / 60
    val s = totalSeconds % 60
    return "$m:" + s.toString().padStart(2, '0')
}

/** Mask the middle of a 10-digit number for the "sent to" line: 98••••••21. */
private fun phoneMasked(local10: String): String {
    val digits = local10.filter { it.isDigit() }
    if (digits.length != 10) return local10
    return digits.take(2) + "••••••" + digits.takeLast(2)
}
