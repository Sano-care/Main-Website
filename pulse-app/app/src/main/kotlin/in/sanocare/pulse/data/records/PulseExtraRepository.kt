package `in`.sanocare.pulse.data.records

import `in`.sanocare.pulse.data.auth.PulseAuthStore
import `in`.sanocare.pulse.data.network.DoseDto
import `in`.sanocare.pulse.data.network.EmailRequest
import `in`.sanocare.pulse.data.network.FamilyAddRequest
import `in`.sanocare.pulse.data.network.HealthNotesRequest
import `in`.sanocare.pulse.data.network.PulseExtraApi
import retrofit2.Response
import javax.inject.Inject
import javax.inject.Singleton

// v2 — glance reads (meds-due, BP trend) + Profile/Family writes. All existing
// bearer endpoints; no new routes. (Identity for Profile comes from the cached
// login session, not a read call — /api/pulse/account is web-cookie-gated.)

@Singleton
class PulseExtraRepository @Inject constructor(
    private val api: PulseExtraApi,
    private val authStore: PulseAuthStore,
) {

    suspend fun schedule(): List<DoseDto> = runCatching {
        val res = api.schedule()
        if (res.code() == 401) authStore.clear()
        if (res.isSuccessful) res.body()?.doses ?: emptyList() else emptyList()
    }.getOrElse { emptyList() }

    /** BP readings (systolic values, oldest→newest) for the Home sparkline. */
    suspend fun bpTrend(): List<Double> = runCatching {
        val res = api.trends(kind = "bp", window = "30d")
        if (res.code() == 401) authStore.clear()
        res.body()?.series?.mapNotNull { it.valueNumeric } ?: emptyList()
    }.getOrElse { emptyList() }

    suspend fun setEmail(email: String): WriteResult =
        call { api.setEmail(EmailRequest(email.trim())) }

    suspend fun setHealthNotes(notes: String?): WriteResult =
        call { api.setHealthNotes(HealthNotesRequest(target = "self", healthNotes = notes?.ifBlank { null })) }

    suspend fun addFamilyMember(name: String, relation: String, relationOther: String?, dob: String?, gender: String?): WriteResult =
        call { api.addFamilyMember(FamilyAddRequest(name.trim(), relation, relationOther?.ifBlank { null }, dob?.ifBlank { null }, gender?.ifBlank { null })) }

    private suspend fun call(block: suspend () -> Response<Unit>): WriteResult =
        runCatching {
            val res = block()
            if (res.code() == 401) { authStore.clear(); return@runCatching WriteResult.Err("Please sign in again.") }
            if (res.isSuccessful) WriteResult.Ok else WriteResult.Err(parseError(res.errorBody()?.string()))
        }.getOrElse { WriteResult.Err(it.message ?: "Network error") }

    private fun parseError(body: String?): String {
        if (body.isNullOrBlank()) return "Something went wrong. Try again."
        val i = body.indexOf("\"error\"")
        if (i < 0) return "Something went wrong. Try again."
        val start = body.indexOf('"', i + 8)
        val end = body.indexOf('"', start + 1)
        return if (start in 0 until end) body.substring(start + 1, end) else "Something went wrong. Try again."
    }
}
