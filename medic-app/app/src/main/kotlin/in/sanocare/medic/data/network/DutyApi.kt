package `in`.sanocare.medic.data.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

// T65 Phase 2 C6/C7 — Retrofit surface for the duty roster + the 4-event
// visit contract.
//
//   GET  api/medic-app/duty?date=YYYY-MM-DD  → today's assigned bookings
//        (date optional; server defaults to today IST).
//   POST api/medic-app/event                 → record one visit event.
//
// gps_location is modelled as a typed nullable GpsLocation (lat/lng) rather
// than a raw JsonElement: the server emits {lat,lng,accuracy} and the Json
// config ignores unknown keys, so the typed shape is both safe and far
// nicer to consume at the call site (BookingDetailScreen's Maps intent).

interface DutyApi {

    @GET("api/medic-app/duty")
    suspend fun fetchDuty(@Query("date") date: String? = null): Response<DutyResponse>

    @POST("api/medic-app/event")
    suspend fun postEvent(@Body body: EventRequest): Response<EventResponse>
}

@Serializable
data class DutyResponse(
    val date: String? = null,
    val bookings: List<BookingDto> = emptyList(),
    val error: String? = null,
)

@Serializable
data class BookingDto(
    val id: String,
    @SerialName("booking_code") val bookingCode: String? = null,
    @SerialName("patient_name") val patientName: String? = null,
    val phone: String? = null,
    @SerialName("service_category") val serviceCategory: String? = null,
    @SerialName("manual_address") val manualAddress: String? = null,
    @SerialName("scheduled_for") val scheduledFor: String? = null,
    val status: String? = null,
    @SerialName("gps_location") val gpsLocation: GpsLocation? = null,
    val events: List<EventDto> = emptyList(),
)

@Serializable
data class GpsLocation(
    val lat: Double,
    val lng: Double,
)

@Serializable
data class EventDto(
    val event: String,
    @SerialName("occurred_at") val occurredAt: String,
)

@Serializable
data class EventRequest(
    @SerialName("booking_id") val bookingId: String,
    val event: String,
    val lat: Double? = null,
    val lng: Double? = null,
)

@Serializable
data class EventResponse(
    @SerialName("event_id") val eventId: String? = null,
    @SerialName("recorded_at") val recordedAt: String? = null,
    val deduped: Boolean = false,
    val error: String? = null,
)
