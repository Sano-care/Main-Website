package `in`.sanocare.medic.data.auth

import `in`.sanocare.medic.data.network.AuthApi
import `in`.sanocare.medic.data.network.SendOtpRequest
import `in`.sanocare.medic.data.network.VerifyOtpRequest
import javax.inject.Inject
import javax.inject.Singleton

// T65 Phase 1 — auth repository. Wraps the Retrofit AuthApi + DataStore
// persistence so VM code calls a single sealed-result surface. All
// suspending methods catch network errors and return a typed failure so
// the VM never has to deal with raw Throwables.

@Singleton
class AuthRepository @Inject constructor(
    private val api: AuthApi,
    private val authDataStore: AuthDataStore,
) {

    suspend fun sendOtp(phone: String): AuthResult<Unit> = runCatching {
        val response = api.sendOtp(SendOtpRequest(phone = normalisePhone(phone)))
        if (response.isSuccessful) {
            AuthResult.Ok(Unit)
        } else {
            val errorBody = parseError(response.errorBody()?.string())
            AuthResult.Err(errorBody, response.code())
        }
    }.getOrElse { AuthResult.Err(it.message ?: "Network error", null) }

    suspend fun verifyOtp(phone: String, otp: String): AuthResult<CachedProfile> = runCatching {
        val response = api.verifyOtp(
            VerifyOtpRequest(phone = normalisePhone(phone), otp = otp, staySignedIn = true),
        )
        if (!response.isSuccessful) {
            return@runCatching AuthResult.Err(
                parseError(response.errorBody()?.string()),
                response.code(),
            )
        }
        val body = response.body()
        if (body?.ok != true || body.role != "medic" || body.medic == null) {
            // Either the closed-signup gate let it through (shouldn't happen),
            // or the server matched a customer not a medic. Either way the
            // medic cookie wasn't minted — surface a clear error.
            return@runCatching AuthResult.Err(
                body?.error ?: "This phone isn't registered as a Sanocare medic.",
                response.code(),
            )
        }
        val m = body.medic
        authDataStore.setProfile(
            medicId = m.id,
            fullName = m.fullName,
            qualification = m.qualification,
        )
        AuthResult.Ok(
            CachedProfile(
                medicId = m.id,
                fullName = m.fullName,
                qualification = m.qualification,
            ),
        )
    }.getOrElse { AuthResult.Err(it.message ?: "Network error", null) }

    suspend fun rehydrate(): AuthResult<CachedProfile> = runCatching {
        // Called on app cold start. Returns Ok if the cookie is still valid
        // server-side, Err otherwise (clears local state on hard failure).
        val response = api.me()
        if (response.code() == 401 || response.code() == 404) {
            authDataStore.clearCookie()
            authDataStore.clearProfile()
            return@runCatching AuthResult.Err("Signed out", response.code())
        }
        val body = response.body()
        if (!response.isSuccessful || body?.medic == null) {
            return@runCatching AuthResult.Err(
                body?.error ?: "Couldn't load profile",
                response.code(),
            )
        }
        val m = body.medic
        authDataStore.setProfile(
            medicId = m.id,
            fullName = m.fullName,
            qualification = m.qualification,
        )
        AuthResult.Ok(
            CachedProfile(
                medicId = m.id,
                fullName = m.fullName,
                qualification = m.qualification,
            ),
        )
    }.getOrElse {
        // Soft-fail on transient network errors — keep cached profile alive so
        // the user can stay in the app offline. The next authed call will
        // either succeed (Wi-Fi back) or 401 (cookie expired).
        AuthResult.Err(it.message ?: "Network error", null)
    }

    suspend fun signOut() {
        runCatching { api.signout() }
        authDataStore.clearCookie()
        authDataStore.clearProfile()
    }

    private fun normalisePhone(input: String): String {
        // Server expects E.164 (+91XXXXXXXXXX). Accept 10-digit and prefix +91;
        // otherwise pass through (server's normaliseIndianPhone re-checks).
        val digits = input.filter { it.isDigit() }
        return if (digits.length == 10) "+91$digits" else input
    }

    private fun parseError(body: String?): String {
        if (body.isNullOrBlank()) return "Request failed"
        // Best-effort: pull `"error":"..."` out without pulling in a json parse.
        val key = "\"error\""
        val i = body.indexOf(key)
        if (i < 0) return "Request failed"
        val start = body.indexOf('"', i + key.length + 1)
        val end = body.indexOf('"', start + 1)
        if (start < 0 || end < 0) return "Request failed"
        return body.substring(start + 1, end)
    }
}

sealed class AuthResult<out T> {
    data class Ok<T>(val value: T) : AuthResult<T>()
    data class Err(val message: String, val code: Int?) : AuthResult<Nothing>()
}
