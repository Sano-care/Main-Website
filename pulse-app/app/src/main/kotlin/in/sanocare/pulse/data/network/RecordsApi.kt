package `in`.sanocare.pulse.data.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

// PB2 — Records read surface. Everything the "From Sanocare" tier needs comes
// from the ONE aggregated read GET /api/pulse/records (bearer-authed via the
// interceptor, customer-scoped server-side). The receipt PDF is the only extra
// call — a bearer-authed byte stream. No new server routes were added.
//
// The Json config sets ignoreUnknownKeys=true, so the payload's other categories
// (vitals/medications/…) are simply dropped — we declare only the 4 we render.

interface RecordsApi {

    @GET("api/pulse/records")
    suspend fun records(@Query("member") member: String): Response<RecordsResponse>

    @Streaming
    @GET("api/pulse/invoices/{bookingId}/receipt")
    suspend fun receipt(@Path("bookingId") bookingId: String): Response<ResponseBody>
}

@Serializable
data class RecordsResponse(
    val records: RecordsPayload? = null,
    val error: String? = null,
)

@Serializable
data class RecordsPayload(
    val bookings: List<BookingDto> = emptyList(),
    val prescriptions: List<PrescriptionDto> = emptyList(),
    val reports: List<ReportDto> = emptyList(),
    val invoices: List<InvoiceDto> = emptyList(),
    // PB3 — hybrid + yours tiers.
    val vitals: List<VitalDto> = emptyList(),
    val medications: List<MedicationDto> = emptyList(),
    val conditions: List<ConditionDto> = emptyList(),
    val allergies: List<AllergyDto> = emptyList(),
    val documents: List<DocumentDto> = emptyList(),
    // Categories the server omitted because a specific member is selected and
    // the category is account-level (vitals, medications, invoices).
    @SerialName("accountLevelOmitted") val accountLevelOmitted: List<String> = emptyList(),
)

@Serializable
data class VitalDto(
    val id: String,
    val kind: String = "",
    @SerialName("value_numeric") val valueNumeric: Double? = null,
    @SerialName("value_secondary") val valueSecondary: Double? = null,
    val unit: String? = null,
    @SerialName("taken_at") val takenAt: String = "",
    @SerialName("context_note") val contextNote: String? = null,
    val source: String = "",
)

@Serializable
data class MedicationDto(
    val id: String,
    val name: String = "",
    val dose: String? = null,
    @SerialName("scheduled_times") val scheduledTimes: List<String>? = null,
    @SerialName("start_date") val startDate: String? = null,
    @SerialName("end_date") val endDate: String? = null,
    val reason: String? = null,
    val source: String? = null,
)

@Serializable
data class ConditionDto(
    val id: String,
    @SerialName("member_id") val memberId: String? = null,
    val label: String = "",
    val status: String = "",
    val source: String = "",
    @SerialName("noted_at") val notedAt: String? = null,
    val notes: String? = null,
    @SerialName("created_at") val createdAt: String = "",
)

@Serializable
data class AllergyDto(
    val id: String,
    @SerialName("member_id") val memberId: String? = null,
    val label: String = "",
    val severity: String = "",
    val reaction: String? = null,
    val status: String = "",
    val source: String = "",
    @SerialName("noted_at") val notedAt: String? = null,
    val notes: String? = null,
    @SerialName("created_at") val createdAt: String = "",
)

@Serializable
data class DocumentDto(
    val id: String,
    @SerialName("member_id") val memberId: String? = null,
    @SerialName("doc_type") val docType: String = "",
    val label: String? = null,
    @SerialName("mime_type") val mimeType: String = "",
    @SerialName("file_size_bytes") val fileSizeBytes: Long = 0,
    val source: String = "",
    @SerialName("uploaded_at") val uploadedAt: String = "",
)

@Serializable
data class BookingDto(
    val id: String,
    @SerialName("member_id") val memberId: String? = null,
    @SerialName("service_category") val serviceCategory: String? = null,
    val status: String = "",
    @SerialName("scheduled_for") val scheduledFor: String? = null,
    @SerialName("created_at") val createdAt: String = "",
)

@Serializable
data class PrescriptionDto(
    val id: String,
    @SerialName("doctor_name") val doctorName: String? = null,
    @SerialName("sent_at") val sentAt: String? = null,
    // Public token → /rx/<token>/pdf (Custom Tab; no bearer needed).
    @SerialName("patient_view_token") val patientViewToken: String? = null,
)

@Serializable
data class ReportDto(
    val id: String,
    @SerialName("service_category") val serviceCategory: String? = null,
    @SerialName("report_uploaded_at") val reportUploadedAt: String? = null,
    // Public token → /reports/<token> (Custom Tab). report_url is never exposed.
    @SerialName("report_unlock_token") val reportUnlockToken: String? = null,
)

@Serializable
data class InvoiceDto(
    @SerialName("booking_id") val bookingId: String,
    @SerialName("booking_code") val bookingCode: String? = null,
    @SerialName("service_category") val serviceCategory: String? = null,
    @SerialName("amount_paise") val amountPaise: Long = 0,
    // CAPTURED (paid) | REFUNDED. NOT_DUE is filtered out server-side.
    val status: String = "",
    @SerialName("payment_ref") val paymentRef: String? = null,
    @SerialName("captured_at") val capturedAt: String? = null,
    @SerialName("created_at") val createdAt: String = "",
)
