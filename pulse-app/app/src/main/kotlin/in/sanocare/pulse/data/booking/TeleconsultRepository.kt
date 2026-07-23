package `in`.sanocare.pulse.data.booking

import `in`.sanocare.pulse.data.auth.PulseAuthStore
import `in`.sanocare.pulse.data.network.CreateOrderDto
import `in`.sanocare.pulse.data.network.CreateOrderRequest
import `in`.sanocare.pulse.data.network.TeleconsultApi
import `in`.sanocare.pulse.data.network.TeleconsultBookingInput
import `in`.sanocare.pulse.data.network.TeleconsultConfigDto
import `in`.sanocare.pulse.data.network.TeleconsultVerifyRequest
import javax.inject.Inject
import javax.inject.Singleton

// PB4a — native teleconsult booking. Thin wrapper over TeleconsultApi:
//   config()      server price for the card + advance amount (no hardcode)
//   createOrder() Razorpay order + publishable keyId (secret stays server-side)
//   verify()      bearer booking + session creation server-side
// 401 clears the local session (matches the other Pulse repositories).

@Singleton
class TeleconsultRepository @Inject constructor(
    private val api: TeleconsultApi,
    private val authStore: PulseAuthStore,
) {

    suspend fun config(): TeleconsultConfigDto? = runCatching {
        val res = api.config()
        if (res.code() == 401) authStore.clear()
        if (res.isSuccessful) res.body() else null
    }.getOrElse { null }

    sealed interface OrderResult {
        data class Ok(val order: CreateOrderDto) : OrderResult
        data class Err(val message: String) : OrderResult
    }

    suspend fun createOrder(): OrderResult = runCatching {
        val res = api.createOrder(CreateOrderRequest())
        val b = res.body()
        if (res.isSuccessful && b?.orderId != null && !b.keyId.isNullOrBlank()) {
            OrderResult.Ok(b)
        } else {
            OrderResult.Err(parseError(res.errorBody()?.string()))
        }
    }.getOrElse { OrderResult.Err(it.message ?: "Network error") }

    sealed interface VerifyResult {
        data class Ok(val bookingCode: String?, val scheduledFor: String?) : VerifyResult
        data class Err(val message: String) : VerifyResult
    }

    suspend fun verify(
        orderId: String,
        paymentId: String,
        signature: String,
        memberId: String?,
        manualAddress: String,
        earliest: Boolean,
        scheduledForIso: String?,
    ): VerifyResult = runCatching {
        val res = api.verify(
            TeleconsultVerifyRequest(
                razorpayOrderId = orderId,
                razorpayPaymentId = paymentId,
                razorpaySignature = signature,
                booking = TeleconsultBookingInput(
                    memberId = memberId,
                    manualAddress = manualAddress,
                    earliest = earliest,
                    scheduledFor = scheduledForIso,
                ),
            ),
        )
        if (res.code() == 401) {
            authStore.clear()
            return@runCatching VerifyResult.Err("Please sign in again.")
        }
        val b = res.body()
        if (res.isSuccessful && b?.ok == true) {
            VerifyResult.Ok(b.bookingCode, b.scheduledFor)
        } else {
            VerifyResult.Err(b?.error ?: parseError(res.errorBody()?.string()))
        }
    }.getOrElse { VerifyResult.Err(it.message ?: "Network error") }

    private fun parseError(body: String?): String {
        if (body.isNullOrBlank()) return "Something went wrong. Try again."
        val i = body.indexOf("\"error\"")
        if (i < 0) return "Something went wrong. Try again."
        val start = body.indexOf('"', i + 8)
        val end = body.indexOf('"', start + 1)
        return if (start in 0 until end) body.substring(start + 1, end) else "Something went wrong. Try again."
    }
}
