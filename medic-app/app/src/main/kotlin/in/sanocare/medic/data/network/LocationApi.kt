package `in`.sanocare.medic.data.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

// T65 Phase 1.5 — batched location ping receiver client.
//
// Separate Retrofit interface (mirrors AuthApi / AttendanceApi pattern)
// so the foreground service can depend on just this surface without
// pulling in auth or attendance APIs.

interface LocationApi {

    @POST("api/medic-app/location")
    suspend fun postBatch(@Body batch: LocationBatch): Response<LocationBatchResponse>
}

@Serializable
data class LocationBatch(
    val pings: List<IncomingPing>,
)

@Serializable
data class IncomingPing(
    @SerialName("pinged_at") val pingedAt: String,
    val lat: Double,
    val lng: Double,
    @SerialName("accuracy_m") val accuracyM: Double? = null,
    @SerialName("battery_pct") val batteryPct: Int? = null,
    @SerialName("speed_mps") val speedMps: Double? = null,
)

@Serializable
data class LocationBatchResponse(
    @SerialName("accepted_count") val acceptedCount: Int? = null,
    @SerialName("discarded_count") val discardedCount: Int? = null,
    val reason: String? = null,
    @SerialName("accepted_at") val acceptedAt: String? = null,
    val error: String? = null,
)
