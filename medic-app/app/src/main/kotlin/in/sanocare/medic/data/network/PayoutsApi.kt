package `in`.sanocare.medic.data.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.GET

// Medic payroll — Retrofit surface for /api/medic-app/payouts.
//
//   GET api/medic-app/payouts → the cookied medic's balance + earned/paid totals
//        + recent ledger entries (newest-first, each with a running balance).
//
// All amounts are signed paise; the UI formats paise→₹. entry_date is a plain
// YYYY-MM-DD (IST work date); created_at is a UTC ISO-8601 instant.

interface PayoutsApi {

    @GET("api/medic-app/payouts")
    suspend fun fetchPayouts(): Response<PayoutsResponse>
}

@Serializable
data class PayoutsResponse(
    @SerialName("balance_paise") val balancePaise: Long = 0,
    @SerialName("total_earned_paise") val totalEarnedPaise: Long = 0,
    @SerialName("total_paid_paise") val totalPaidPaise: Long = 0,
    val entries: List<LedgerEntryDto> = emptyList(),
    val error: String? = null,
)

@Serializable
data class LedgerEntryDto(
    val id: String,
    @SerialName("entry_type") val entryType: String,
    @SerialName("amount_paise") val amountPaise: Long,
    @SerialName("entry_date") val entryDate: String,
    val description: String? = null,
    @SerialName("running_balance_paise") val runningBalancePaise: Long = 0,
    @SerialName("created_at") val createdAt: String? = null,
)
