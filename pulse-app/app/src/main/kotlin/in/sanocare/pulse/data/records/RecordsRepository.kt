package `in`.sanocare.pulse.data.records

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import `in`.sanocare.pulse.data.auth.PulseAuthStore
import `in`.sanocare.pulse.data.network.RecordsApi
import `in`.sanocare.pulse.data.network.RecordsPayload
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

// PB2 — Records read repository. One aggregated fetch (GET /api/pulse/records)
// for all four "From Sanocare" lists, plus the bearer-authed receipt PDF stream.
// Read-only; no writes anywhere.

@Singleton
class RecordsRepository @Inject constructor(
    private val api: RecordsApi,
    private val authStore: PulseAuthStore,
    @ApplicationContext private val context: Context,
) {

    suspend fun load(): RecordsResult = runCatching {
        val res = api.records()
        if (res.code() == 401) {
            // Token revoked/invalid — drop it so the gate routes to login.
            authStore.clear()
            return@runCatching RecordsResult.Unauthorized
        }
        val body = res.body()
        if (!res.isSuccessful || body?.records == null) {
            return@runCatching RecordsResult.Error(body?.error ?: "Couldn't load your records.")
        }
        RecordsResult.Data(body.records)
    }.getOrElse { RecordsResult.Error(it.message ?: "Network error") }

    /**
     * Download the bearer-authed receipt PDF to the app cache, returning the
     * File to hand to the system viewer (or null on failure). The token/URL is
     * never logged.
     */
    suspend fun downloadReceipt(bookingId: String, bookingCode: String?): File? = runCatching {
        val res = api.receipt(bookingId)
        if (res.code() == 401) {
            authStore.clear()
            return@runCatching null
        }
        if (!res.isSuccessful) return@runCatching null
        val bytes = res.body()?.bytes() ?: return@runCatching null
        val dir = File(context.cacheDir, "receipts").apply { mkdirs() }
        val safe = (bookingCode ?: bookingId).replace(Regex("[^A-Za-z0-9._-]"), "_")
        File(dir, "Sanocare-Receipt-$safe.pdf").apply { writeBytes(bytes) }
    }.getOrElse { null }
}

sealed interface RecordsResult {
    data class Data(val payload: RecordsPayload) : RecordsResult
    data object Unauthorized : RecordsResult
    data class Error(val message: String) : RecordsResult
}
