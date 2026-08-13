package `in`.sanocare.pulse.data.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

// PB5b — native Medic-at-Home tier cart.
//   catalog()     GET  /api/pulse/medic/catalog       → frozen procedure catalog
//   quote()       POST /api/pulse/medic/quote         → server-authoritative total
//   createOrder() POST /api/pulse/medic/create-order  → Razorpay order for prepay
//   verify()      POST /api/pulse/medic/verify        → bearer booking + line items
// The client NEVER computes a price; every rupee comes from the server (paise).

interface MedicApi {

    @GET("api/pulse/medic/catalog")
    suspend fun catalog(): Response<MedicCatalogDto>

    @POST("api/pulse/medic/quote")
    suspend fun quote(@Body req: MedicCartRequest): Response<MedicQuoteDto>

    @POST("api/pulse/medic/create-order")
    suspend fun createOrder(@Body req: MedicCartRequest): Response<MedicCreateOrderDto>

    @POST("api/pulse/medic/verify")
    suspend fun verify(@Body req: MedicVerifyRequest): Response<MedicVerifyDto>
}

@Serializable
data class MedicCatalogDto(
    @SerialName("base_visit_paise") val baseVisitPaise: Long = 19_900,
    @SerialName("base_extra_unit_paise") val baseExtraUnitPaise: Long = 10_000,
    val procedures: List<ProcedureDto> = emptyList(),
)

@Serializable
data class ProcedureDto(
    val code: String,
    val name: String? = null,
    val category: String? = null,
    val tier: String? = null,
    @SerialName("rx_required") val rxRequired: String? = null,
    @SerialName("is_base_included") val isBaseIncluded: Boolean = false,
    @SerialName("absolute_price_paise") val absolutePricePaise: Long = 0,
    @SerialName("delta_paise") val deltaPaise: Long = 0,
    @SerialName("price_type") val priceType: String? = null,
    @SerialName("per_unit_addon_paise") val perUnitAddonPaise: Long? = null,
    @SerialName("hourly_addon_paise") val hourlyAddonPaise: Long? = null,
    @SerialName("consumables_borne_by") val consumablesBorneBy: String? = null,
    @SerialName("consumables_note") val consumablesNote: String? = null,
    @SerialName("duration_min") val durationMin: String? = null,
    val description: String? = null,
    @SerialName("display_order") val displayOrder: Int = 0,
)

@Serializable
data class CartItemDto(
    val code: String,
    val qty: Int,
    val units: Int? = null,
    val hours: Int? = null,
)

@Serializable
data class MedicCartRequest(val items: List<CartItemDto>)

@Serializable
data class QuoteDto(
    @SerialName("total_paise") val totalPaise: Long = 0,
    @SerialName("prepay_paise") val prepayPaise: Long = 0,
    @SerialName("at_visit_paise") val atVisitPaise: Long = 0,
    @SerialName("line_items") val lineItems: List<LineItemDto> = emptyList(),
)

@Serializable
data class LineItemDto(
    val code: String,
    val name: String? = null,
    val tier: String? = null,
    val qty: Int = 0,
    @SerialName("unit_price_paise") val unitPricePaise: Long = 0,
    @SerialName("line_total_paise") val lineTotalPaise: Long = 0,
    @SerialName("is_variable") val isVariable: Boolean = false,
)

@Serializable
data class RxDto(
    val required: List<String> = emptyList(),
    val caseByCase: List<String> = emptyList(),
)

@Serializable
data class MedicQuoteDto(
    val quote: QuoteDto = QuoteDto(),
    val rx: RxDto = RxDto(),
    val error: String? = null,
)

@Serializable
data class MedicCreateOrderDto(
    val orderId: String? = null,
    val amount: Long = 0, // paise
    val currency: String = "INR",
    val keyId: String? = null, // Razorpay publishable key
    val quote: QuoteDto = QuoteDto(),
    val error: String? = null,
)

@Serializable
data class MedicVerifyRequest(
    @SerialName("razorpay_order_id") val razorpayOrderId: String,
    @SerialName("razorpay_payment_id") val razorpayPaymentId: String,
    @SerialName("razorpay_signature") val razorpaySignature: String,
    val items: List<CartItemDto>,
    val booking: MedicBookingInput,
)

@Serializable
data class MedicBookingInput(
    @SerialName("member_id") val memberId: String? = null,
    @SerialName("manual_address") val manualAddress: String,
)

@Serializable
data class MedicVerifyDto(
    val ok: Boolean = false,
    val bookingId: String? = null,
    val bookingCode: String? = null,
    val prepayPaise: Long = 0,
    val atVisitPaise: Long = 0,
    val error: String? = null,
)
