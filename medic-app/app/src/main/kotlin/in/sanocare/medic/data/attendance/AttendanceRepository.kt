package `in`.sanocare.medic.data.attendance

import `in`.sanocare.medic.data.auth.AuthResult
import `in`.sanocare.medic.data.network.AttendanceActionRequest
import `in`.sanocare.medic.data.network.AttendanceApi
import `in`.sanocare.medic.data.network.AttendanceRow
import `in`.sanocare.medic.data.network.SelfiePrompt
import javax.inject.Inject
import javax.inject.Singleton

/** Clock-in result: the now-open attendance row + the optional selfie nudge. */
data class ClockInResult(
    val openRow: AttendanceRow,
    val selfiePrompt: SelfiePrompt?,
)

// T65 Phase 1 C4 — attendance repo. Same AuthResult pattern as
// AuthRepository so the VM stays consistent across surfaces.

@Singleton
class AttendanceRepository @Inject constructor(
    private val api: AttendanceApi,
) {

    suspend fun fetchOpen(): AuthResult<AttendanceRow?> = runCatching {
        val response = api.get()
        if (!response.isSuccessful) {
            return@runCatching AuthResult.Err(
                response.body()?.error ?: "Couldn't load attendance",
                response.code(),
            )
        }
        AuthResult.Ok(response.body()?.open)
    }.getOrElse { AuthResult.Err(it.message ?: "Network error", null) }

    suspend fun clockIn(lat: Double?, lng: Double?): AuthResult<ClockInResult> = runCatching {
        val response = api.post(AttendanceActionRequest("clock_in", lat, lng))
        val body = response.body()
        if (!response.isSuccessful || body?.open == null) {
            return@runCatching AuthResult.Err(
                body?.error ?: "Couldn't clock in",
                response.code(),
            )
        }
        AuthResult.Ok(ClockInResult(body.open, body.selfiePrompt))
    }.getOrElse { AuthResult.Err(it.message ?: "Network error", null) }

    suspend fun clockOut(lat: Double?, lng: Double?): AuthResult<AttendanceRow> = runCatching {
        val response = api.post(AttendanceActionRequest("clock_out", lat, lng))
        val body = response.body()
        if (!response.isSuccessful || body?.last == null) {
            return@runCatching AuthResult.Err(
                body?.error ?: "Couldn't clock out",
                response.code(),
            )
        }
        AuthResult.Ok(body.last)
    }.getOrElse { AuthResult.Err(it.message ?: "Network error", null) }
}
