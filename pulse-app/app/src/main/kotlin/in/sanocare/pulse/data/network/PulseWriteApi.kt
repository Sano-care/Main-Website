package `in`.sanocare.pulse.data.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query

// PB3 — patient writes + family list + document upload/open. All bearer-authed
// (interceptor). Every route reuses an EXISTING server endpoint — no new API was
// added. The server sets source ('manual'/'patient'), forces customer_id to the
// session, and IDOR-guards member_id, so the client never asserts authorization.

interface PulseWriteApi {

    // Vitals + Medications — account-level (no member_id).
    @POST("api/pulse/vitals")
    suspend fun logVital(@Body req: VitalLogRequest): Response<Unit>

    @DELETE("api/pulse/vitals/{id}")
    suspend fun deleteVital(@Path("id") id: String): Response<Unit>

    @POST("api/pulse/medications")
    suspend fun addMedication(@Body req: MedicationAddRequest): Response<Unit>

    @DELETE("api/pulse/medications/{id}")
    suspend fun deleteMedication(@Path("id") id: String): Response<Unit>

    // Conditions + Allergies — member-scoped (server IDOR-guards member_id).
    @POST("api/pulse/conditions")
    suspend fun addCondition(@Body req: ConditionAddRequest): Response<Unit>

    @DELETE("api/pulse/conditions")
    suspend fun deleteCondition(@Query("id") id: String): Response<Unit>

    @POST("api/pulse/allergies")
    suspend fun addAllergy(@Body req: AllergyAddRequest): Response<Unit>

    @DELETE("api/pulse/allergies")
    suspend fun deleteAllergy(@Query("id") id: String): Response<Unit>

    // Documents — multipart upload + signed-URL open (member-scoped).
    @Multipart
    @POST("api/pulse/documents")
    suspend fun uploadDocument(
        @Part file: MultipartBody.Part,
        @Part("doc_type") docType: RequestBody?,
        @Part("member_id") memberId: RequestBody?,
    ): Response<Unit>

    @GET("api/pulse/documents/{docId}/signed-url")
    suspend fun documentSignedUrl(@Path("docId") docId: String): Response<SignedUrlResponse>

    // Family members — the switcher + add.
    @GET("api/pulse/family-members")
    suspend fun familyMembers(): Response<FamilyMembersResponse>
}

// ── Request bodies ──────────────────────────────────────────────────────────

@Serializable
data class VitalLogRequest(
    val kind: String,
    @SerialName("value_numeric") val valueNumeric: Double,
    @SerialName("value_secondary") val valueSecondary: Double? = null,
    @SerialName("taken_at") val takenAt: String,
    @SerialName("context_note") val contextNote: String? = null,
)

@Serializable
data class MedicationAddRequest(
    val name: String,
    val dose: String,
    @SerialName("frequency_label") val frequencyLabel: String,
    @SerialName("times_per_day") val timesPerDay: Int,
    @SerialName("start_date") val startDate: String? = null,
    @SerialName("end_date") val endDate: String? = null,
    val reason: String? = null,
)

@Serializable
data class ConditionAddRequest(
    val label: String,
    val status: String? = null,
    @SerialName("noted_at") val notedAt: String? = null,
    val notes: String? = null,
    @SerialName("member_id") val memberId: String? = null,
)

@Serializable
data class AllergyAddRequest(
    val label: String,
    val severity: String? = null,
    val reaction: String? = null,
    val status: String? = null,
    @SerialName("noted_at") val notedAt: String? = null,
    val notes: String? = null,
    @SerialName("member_id") val memberId: String? = null,
)

// ── Responses ───────────────────────────────────────────────────────────────

@Serializable
data class SignedUrlResponse(val url: String? = null, val error: String? = null)

@Serializable
data class FamilyMembersResponse(val members: List<FamilyMemberDto> = emptyList())

@Serializable
data class FamilyMemberDto(
    val id: String,
    val name: String = "",
    val relation: String? = null,
    @SerialName("relation_other") val relationOther: String? = null,
    val dob: String? = null,
    val gender: String? = null,
)
