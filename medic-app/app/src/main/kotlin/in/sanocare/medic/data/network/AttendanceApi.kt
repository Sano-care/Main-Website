package `in`.sanocare.medic.data.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

// T65 Phase 1 C4 — Retrofit surface for /api/medic-app/attendance.

interface AttendanceApi {

    @GET("api/medic-app/attendance")
    suspend fun get(): Response<AttendanceStateResponse>

    @POST("api/medic-app/attendance")
    suspend fun post(@Body body: AttendanceActionRequest): Response<AttendanceActionResponse>
}

@Serializable
data class AttendanceRow(
    val id: String,
    @SerialName("medic_id") val medicId: String,
    @SerialName("clock_in_at") val clockInAt: String,
    @SerialName("clock_out_at") val clockOutAt: String? = null,
    @SerialName("clock_in_lat") val clockInLat: Double? = null,
    @SerialName("clock_in_lng") val clockInLng: Double? = null,
    @SerialName("clock_out_lat") val clockOutLat: Double? = null,
    @SerialName("clock_out_lng") val clockOutLng: Double? = null,
)

@Serializable
data class AttendanceStateResponse(
    val open: AttendanceRow? = null,
    val error: String? = null,
)

@Serializable
data class AttendanceActionRequest(
    val action: String,
    val lat: Double? = null,
    val lng: Double? = null,
)

@Serializable
data class AttendanceActionResponse(
    val open: AttendanceRow? = null,
    val last: AttendanceRow? = null,
    val error: String? = null,
)
