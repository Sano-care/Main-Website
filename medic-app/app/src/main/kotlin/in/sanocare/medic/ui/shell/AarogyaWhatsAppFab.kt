package `in`.sanocare.medic.ui.shell

import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import `in`.sanocare.medic.R

// T-Aarogya-Phase1 Track A (A1+A2) — WhatsApp → Aarogya entry point on the
// Medic App home.
//
// Tap opens WhatsApp to the Sanocare business number with a prefilled greeting
// that names the medic, so Aarogya's identity routing has a name to work with
// even before the backend phone lookup (Track C) is live end-to-end. Until
// identity routing activates, Aarogya simply handles the medic as it would any
// caller — graceful no-op.
//
// Independent of Track C: this ships on the Android side ahead of (and without
// dependency on) the identity backend.

private const val AAROGYA_WA_NUMBER = "919711977782"
private const val TAG = "AarogyaWhatsAppFab"

@Composable
fun AarogyaWhatsAppFab(medicFullName: String) {
    val context = LocalContext.current
    val greeting = stringResource(R.string.whatsapp_fab_greeting, medicFullName)
    val label = stringResource(R.string.whatsapp_fab_label)

    ExtendedFloatingActionButton(
        onClick = {
            // wa.me requires the text param URL-encoded; Uri.encode handles it.
            val url = "https://wa.me/$AAROGYA_WA_NUMBER?text=${Uri.encode(greeting)}"
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            runCatching { context.startActivity(intent) }
                .onFailure { Log.w(TAG, "Could not open WhatsApp", it) }
        },
        icon = { Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = null) },
        text = { Text(label) },
    )
}
