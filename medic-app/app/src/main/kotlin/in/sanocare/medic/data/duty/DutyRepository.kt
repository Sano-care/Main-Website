package `in`.sanocare.medic.data.duty

import `in`.sanocare.medic.data.auth.AuthResult
import `in`.sanocare.medic.data.network.BookingDto
import `in`.sanocare.medic.data.network.DutyApi
import `in`.sanocare.medic.data.network.EventRequest
import `in`.sanocare.medic.data.network.EventResponse
import javax.inject.Inject
import javax.inject.Singleton

// T65 Phase 2 C6/C7 — duty repository. Same AuthResult wrapper as the other
// repos so the VMs stay uniform. A 401 surfaces as AuthResult.Err with
// code=401 — callers (BookingDetail) treat that as "session expired →
// bounce to login".

@Singleton
class DutyRepository @Inject constructor(
    private val api: DutyApi,
) {

    suspend fun fetchDuty(date: String?): AuthResult<List<BookingDto>> = runCatching {
        val response = api.fetchDuty(date)
        if (response.code() == 401) {
            return@runCatching AuthResult.Err("Signed out", 401)
        }
        val body = response.body()
        if (!response.isSuccessful || body == null) {
            return@runCatching AuthResult.Err(
                body?.error ?: "Couldn't load today's visits",
                response.code(),
            )
        }
        AuthResult.Ok(body.bookings)
    }.getOrElse { AuthResult.Err(it.message ?: "Network error", null) }

    suspend fun recordEvent(
        bookingId: String,
        event: String,
        lat: Double?,
        lng: Double?,
    ): AuthResult<EventResponse> = runCatching {
        val response = api.postEvent(EventRequest(bookingId, event, lat, lng))
        if (response.code() == 401) {
            return@runCatching AuthResult.Err("Signed out", 401)
        }
        val body = response.body()
        // The route returns 200 (deduped) or 201 (fresh); both are success
        // and both carry event_id.
        if (!response.isSuccessful || body?.eventId == null) {
            return@runCatching AuthResult.Err(
                body?.error ?: "Couldn't record event",
                response.code(),
            )
        }
        AuthResult.Ok(body)
    }.getOrElse { AuthResult.Err(it.message ?: "Network error", null) }
}
