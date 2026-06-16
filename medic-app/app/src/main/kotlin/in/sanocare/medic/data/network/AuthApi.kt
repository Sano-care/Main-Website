package `in`.sanocare.medic.data.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

// T65 Phase 1 — Retrofit surface for the medic auth + profile endpoints.
// Cookie attach/save is handled by SanocareCookieJar on the OkHttp client;
// these methods don't carry the cookie explicitly.

interface AuthApi {

    @POST("api/auth/send-otp")
    suspend fun sendOtp(@Body req: SendOtpRequest): Response<SendOtpResponse>

    @POST("api/auth/verify-otp")
    suspend fun verifyOtp(@Body req: VerifyOtpRequest): Response<VerifyOtpResponse>

    @GET("api/medic-app/me")
    suspend fun me(): Response<MeResponse>

    @POST("api/medic-app/signout")
    suspend fun signout(): Response<Unit>
}

@Serializable
data class SendOtpRequest(
    val phone: String,
    val medic: Boolean = true,
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
)

@Serializable
data class VerifyOtpResponse(
    val ok: Boolean = false,
    val role: String? = null,
    val medic: MedicPayload? = null,
    val error: String? = null,
    val attemptsRemaining: Int? = null,
)

@Serializable
data class MedicPayload(
    val id: String,
    @SerialName("full_name") val fullName: String,
    val qualification: String,
    val phone: String? = null,
)

@Serializable
data class MeResponse(
    val medic: MedicPayload? = null,
    val error: String? = null,
)
