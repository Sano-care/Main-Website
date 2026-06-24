package `in`.sanocare.medic.data.payouts

import `in`.sanocare.medic.data.auth.AuthResult
import `in`.sanocare.medic.data.network.PayoutsApi
import `in`.sanocare.medic.data.network.PayoutsResponse
import javax.inject.Inject
import javax.inject.Singleton

// Medic payroll — payouts repository. Same AuthResult wrapper as the duty /
// attendance repos so the VM stays uniform. A 401 surfaces as AuthResult.Err
// with code=401 (caller bounces to login).

@Singleton
class PayoutsRepository @Inject constructor(
    private val api: PayoutsApi,
) {

    suspend fun fetchPayouts(): AuthResult<PayoutsResponse> = runCatching {
        val response = api.fetchPayouts()
        if (response.code() == 401) {
            return@runCatching AuthResult.Err("Signed out", 401)
        }
        val body = response.body()
        if (!response.isSuccessful || body == null) {
            return@runCatching AuthResult.Err(
                body?.error ?: "Couldn't load payouts",
                response.code(),
            )
        }
        AuthResult.Ok(body)
    }.getOrElse { AuthResult.Err(it.message ?: "Network error", null) }
}
