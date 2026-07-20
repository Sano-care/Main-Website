package `in`.sanocare.pulse.data.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

// v2 — extra reads for the Home "care at a glance" section + the Profile/Family
// screens. Every route is an EXISTING bearer endpoint (medications/schedule,
// vitals/trends, profile/email, profile/health-notes, family-members). No new
// server routes. (Identity for Profile is read from the cached login session, not
// /api/pulse/account — that GET is gated by the web OTP cookie, not the bearer.)

interface PulseExtraApi {

    @GET("api/pulse/medications/schedule")
    suspend fun schedule(): Response<ScheduleResponse>

    @GET("api/pulse/vitals/trends")
    suspend fun trends(
        @Query("kind") kind: String,
        @Query("window") window: String = "30d",
    ): Response<TrendsResponse>

    @POST("api/pulse/profile/email")
    suspend fun setEmail(@Body req: EmailRequest): Response<Unit>

    @POST("api/pulse/profile/health-notes")
    suspend fun setHealthNotes(@Body req: HealthNotesRequest): Response<Unit>

    @POST("api/pulse/family-members")
    suspend fun addFamilyMember(@Body req: FamilyAddRequest): Response<Unit>
}

@Serializable
data class ScheduleResponse(val doses: List<DoseDto> = emptyList())

@Serializable
data class DoseDto(
    @SerialName("intake_id") val intakeId: String? = null,
    val name: String = "",
    val dose: String? = null,
    @SerialName("scheduled_at") val scheduledAt: String? = null,
    val state: String? = null,
)

@Serializable
data class TrendsResponse(
    val series: List<TrendPointDto> = emptyList(),
    val summary: TrendSummaryDto? = null,
)

@Serializable
data class TrendPointDto(
    @SerialName("value_numeric") val valueNumeric: Double? = null,
    @SerialName("value_secondary") val valueSecondary: Double? = null,
    @SerialName("taken_at") val takenAt: String = "",
)

@Serializable
data class TrendSummaryDto(
    val count: Int = 0,
    val latest: String? = null,
    val min: Double? = null,
    val max: Double? = null,
    val average: Double? = null,
)

@Serializable
data class EmailRequest(val email: String)

// Self-target only in v2 (member health-notes uses the object target form).
@Serializable
data class HealthNotesRequest(
    val target: String = "self",
    @SerialName("health_notes") val healthNotes: String?,
)

@Serializable
data class FamilyAddRequest(
    val name: String,
    val relation: String,
    @SerialName("relation_other") val relationOther: String? = null,
    val dob: String? = null,
    val gender: String? = null,
)
