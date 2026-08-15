package `in`.sanocare.pulse.data.booking

import `in`.sanocare.pulse.data.auth.PulseAuthStore
import `in`.sanocare.pulse.data.network.CartItemDto
import `in`.sanocare.pulse.data.network.MedicApi
import `in`.sanocare.pulse.data.network.MedicBookingInput
import `in`.sanocare.pulse.data.network.MedicCartRequest
import `in`.sanocare.pulse.data.network.MedicCatalogDto
import `in`.sanocare.pulse.data.network.MedicCreateOrderDto
import `in`.sanocare.pulse.data.network.MedicCreateOrderRequest
import `in`.sanocare.pulse.data.network.MedicQuoteDto
import `in`.sanocare.pulse.data.network.MedicVerifyRequest
import javax.inject.Inject
import javax.inject.Singleton

// PB5b — native Medic-at-Home cart. Thin wrapper over MedicApi. Money is
// server-authoritative: quote/create-order/verify all price server-side; the
// app only relays {code, qty, units?, hours?}. 401 clears the local session
// (matches the other Pulse repositories).

@Singleton
class MedicRepository @Inject constructor(
    private val api: MedicApi,
    private val authStore: PulseAuthStore,
) {

    suspend fun catalog(): MedicCatalogDto? = runCatching {
        val res = api.catalog()
        if (res.code() == 401) authStore.clear()
        if (res.isSuccessful) res.body() else null
    }.getOrElse { null }

    /** Live quote for the sticky total. Returns null on any failure (the UI
     *  keeps the last good total rather than flashing an error per keystroke). */
    suspend fun quote(items: List<CartItemDto>): MedicQuoteDto? = runCatching {
        val res = api.quote(MedicCartRequest(items))
        if (res.code() == 401) authStore.clear()
        if (res.isSuccessful) res.body() else null
    }.getOrElse { null }

    sealed interface OrderResult {
        data class Ok(val order: MedicCreateOrderDto) : OrderResult
        data class Err(val message: String) : OrderResult
    }

    suspend fun createOrder(items: List<CartItemDto>, paymentMode: String): OrderResult = runCatching {
        val res = api.createOrder(MedicCreateOrderRequest(items = items, paymentMode = paymentMode))
        if (res.code() == 401) {
            authStore.clear()
            return@runCatching OrderResult.Err("Please sign in again.")
        }
        val b = res.body()
        if (res.isSuccessful && b?.orderId != null && !b.keyId.isNullOrBlank()) {
            OrderResult.Ok(b)
        } else {
            OrderResult.Err(b?.error ?: parseError(res.errorBody()?.string()))
        }
    }.getOrElse { OrderResult.Err(it.message ?: "Network error") }

    sealed interface VerifyResult {
        data class Ok(
            val bookingCode: String?,
            val chargedPaise: Long,
            val balancePaise: Long,
            val atVisitPaise: Long,
        ) : VerifyResult
        data class Err(val message: String) : VerifyResult
    }

    suspend fun verify(
        orderId: String,
        paymentId: String,
        signature: String,
        items: List<CartItemDto>,
        memberId: String?,
        manualAddress: String,
    ): VerifyResult = runCatching {
        val res = api.verify(
            MedicVerifyRequest(
                razorpayOrderId = orderId,
                razorpayPaymentId = paymentId,
                razorpaySignature = signature,
                items = items,
                booking = MedicBookingInput(memberId = memberId, manualAddress = manualAddress),
            ),
        )
        if (res.code() == 401) {
            authStore.clear()
            return@runCatching VerifyResult.Err("Please sign in again.")
        }
        val b = res.body()
        if (res.isSuccessful && b?.ok == true) {
            VerifyResult.Ok(b.bookingCode, b.chargedPaise, b.balancePaise, b.atVisitPaise)
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
