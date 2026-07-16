package `in`.sanocare.pulse.data.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

// PB1 — Retrofit surface for the patient auth endpoints. The
// X-Sanocare-Client + Authorization headers are attached by
// BearerAuthInterceptor, so these methods don't declare them.

interface AuthApi {

    @POST("api/auth/send-otp")
    suspend fun sendOtp(@Body req: SendOtpRequest): Response<SendOtpResponse>

    @POST("api/auth/verify-otp")
    suspend fun verifyOtp(@Body req: VerifyOtpRequest): Response<VerifyOtpResponse>

    @POST("api/pulse/signout")
    suspend fun signout(): Response<Unit>
}

@Serializable
data class SendOtpRequest(
    val phone: String,
    // Patient app: default channel routing (WhatsApp-first) — NOT the medic gate.
    val channel: String = "auto",
)

@Serializable
data class SendOtpResponse(
    val ok: Boolean = false,
    val channel: String? = null,
    val expiresInSeconds: Int? = null,
    val error: String? = null,
    val retryAfterSeconds: Int? = null,
)

@Serializable
data class VerifyOtpRequest(
    val phone: String,
    val otp: String,
    @SerialName("stay_signed_in") val staySignedIn: Boolean = true,
    // Human-readable device label persisted server-side (mobile_session_tokens)
    // for a future "manage devices" surface. e.g. "Redmi Note 12".
    @SerialName("device_label") val deviceLabel: String? = null,
)

@Serializable
data class VerifyOtpResponse(
    val ok: Boolean = false,
    val phone: String? = null,
    val role: String? = null, // "medic" when the number is Sanocare staff
    @SerialName("customer_id") val customerId: String? = null,
    @SerialName("full_name") val fullName: String? = null,
    @SerialName("is_new_customer") val isNewCustomer: Boolean = false,
    // The opaque bearer token — present only for the mobile customer path.
    @SerialName("mobile_token") val mobileToken: String? = null,
    val error: String? = null,
    val attemptsRemaining: Int? = null,
)
