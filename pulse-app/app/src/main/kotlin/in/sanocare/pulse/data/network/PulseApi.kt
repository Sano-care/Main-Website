package `in`.sanocare.pulse.data.network

import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Query

// PB1 — a single authenticated /api/pulse/* GET, used as the session-validity
// probe on cold start (AuthGate). It proves the acceptance criterion that
// `Authorization: Bearer` resolves on a real Pulse route: 200 → session live,
// 401 → route back to login. The records payload itself is ignored in PB1
// (records UI is PB2); `SessionPing` parses to an empty object via the Json
// `ignoreUnknownKeys` config.

interface PulseApi {

    @GET("api/pulse/records")
    suspend fun sessionCheck(@Query("member") member: String = "self"): Response<SessionPing>
}

@Serializable
class SessionPing
