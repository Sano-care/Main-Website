package `in`.sanocare.pulse.ui.records

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.FileProvider
import java.io.File

// PB2 — open helpers. Public token-gated pages (Rx PDF, lab report) open in a
// Chrome Custom Tab; the bearer-authed receipt PDF is downloaded first, then
// handed to the system PDF viewer via a scoped FileProvider content URI.
// URLs/tokens are never logged.

object RecordOpen {
    // Matches NetworkModule.BASE_URL.
    private const val BASE = "https://sanocare.in"

    fun rxPdfUrl(patientViewToken: String): String = "$BASE/rx/$patientViewToken/pdf"
    fun reportUrl(reportUnlockToken: String): String = "$BASE/reports/$reportUnlockToken"

    fun openInCustomTab(context: Context, url: String) {
        runCatching {
            CustomTabsIntent.Builder()
                .setShowTitle(true)
                .build()
                .launchUrl(context, Uri.parse(url))
        }.onFailure {
            // Fall back to any browser if no Custom Tabs provider is present.
            runCatching {
                context.startActivity(
                    Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
        }
    }

    /** Open a downloaded PDF in the system viewer. Returns false if nothing can open it. */
    fun openPdf(context: Context, file: File): Boolean = runCatching {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/pdf")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(intent)
        true
    }.getOrElse { false }
}
