package `in`.sanocare.pulse.data.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

// PB4a — native teleconsultation booking + payment.
//   config()      GET  /api/pulse/teleconsult/config  → server price (no hardcode)
//   createOrder() POST /api/razorpay/create-order      → Razorpay order + keyId
//                                                         (publishable key only)
//   verify()      POST /api/pulse/teleconsult/verify   → bearer booking + session
// Signature check + booking persistence stay server-side; the app never sees the
// Razorpay secret.

interface TeleconsultApi {

    @GET("api/pulse/teleconsult/config")
    suspend fun config(): Response<TeleconsultConfigDto>

    @POST("api/razorpay/create-order")
    suspend fun createOrder(@Body req: CreateOrderRequest): Response<CreateOrderDto>

    @POST("api/pulse/teleconsult/verify")
    suspend fun verify(@Body req: TeleconsultVerifyRequest): Response<TeleconsultVerifyDto>
}

@Serializable
data class TeleconsultConfigDto(
    @SerialName("display_inr") val displayInr: Int = 0,
    @SerialName("advance_paise") val advancePaise: Long = 0,
    val currency: String = "INR",
)

@Serializable
data class CreateOrderRequest(
    @SerialName("t85Slug") val t85Slug: String = "teleconsultation",
)

@Serializable
data class CreateOrderDto(
    val orderId: String? = null,
    val amount: Long = 0, // paise
    val currency: String = "INR",
    val keyId: String? = null, // Razorpay publishable key
)

@Serializable
data class TeleconsultVerifyRequest(
    @SerialName("razorpay_order_id") val razorpayOrderId: String,
    @SerialName("razorpay_payment_id") val razorpayPaymentId: String,
    @SerialName("razorpay_signature") val razorpaySignature: String,
    val booking: TeleconsultBookingInput,
)

@Serializable
data class TeleconsultBookingInput(
    @SerialName("member_id") val memberId: String? = null,
    @SerialName("manual_address") val manualAddress: String,
    val earliest: Boolean = false,
    @SerialName("scheduled_for") val scheduledFor: String? = null,
)

@Serializable
data class TeleconsultVerifyDto(
    val ok: Boolean = false,
    val bookingId: String? = null,
    val bookingCode: String? = null,
    val scheduledFor: String? = null,
    val error: String? = null,
)
