package `in`.sanocare.pulse.data.auth

import android.os.Build
import `in`.sanocare.pulse.data.network.AuthApi
import `in`.sanocare.pulse.data.network.PulseApi
import `in`.sanocare.pulse.data.network.SendOtpRequest
import `in`.sanocare.pulse.data.network.VerifyOtpRequest
import javax.inject.Inject
import javax.inject.Singleton

// PB1 — auth repository. Wraps AuthApi/PulseApi + the EncryptedSharedPreferences
// token store behind a typed surface. On verify success it persists the bearer
// token; on 401 it clears local state. Never logs the token.

@Singleton
class AuthRepository @Inject constructor(
    private val authApi: AuthApi,
    private val pulseApi: PulseApi,
    private val authStore: PulseAuthStore,
) {

    fun isSignedIn(): Boolean = authStore.isSignedIn()

    fun cached(): CachedCustomer = CachedCustomer(authStore.customerId, authStore.fullName, authStore.phone)

    suspend fun sendOtp(phone: String): AuthResult<Unit> = runCatching {
        val res = authApi.sendOtp(SendOtpRequest(phone = normalisePhone(phone)))
        if (res.isSuccessful) AuthResult.Ok(Unit)
        else AuthResult.Err(parseError(res.errorBody()?.string()), res.code())
    }.getOrElse { AuthResult.Err(it.message ?: "Network error", null) }

    suspend fun verifyOtp(phone: String, otp: String): VerifyOutcome = runCatching {
        val res = authApi.verifyOtp(
            VerifyOtpRequest(
                phone = normalisePhone(phone),
                otp = otp,
                staySignedIn = true,
                deviceLabel = deviceLabel(),
            ),
        )
        if (!res.isSuccessful) {
            return@runCatching VerifyOutcome.Error(parseError(res.errorBody()?.string()))
        }
        val body = res.body()
        if (body?.ok != true) {
            return@runCatching VerifyOutcome.Error(body?.error ?: "Could not verify the code.")
        }
        // Edge case 1: a Sanocare-staff number returns role="medic" and no
        // patient token. Direct the user to the Medic app; do not sign in.
        if (body.role == "medic") {
            return@runCatching VerifyOutcome.MedicNumber
        }
        val token = body.mobileToken
        if (token.isNullOrBlank()) {
            // Customer path but no token minted — treat as a hard failure rather
            // than a half-authenticated state.
            return@runCatching VerifyOutcome.Error("Could not start a session. Please try again.")
        }
        authStore.saveSession(
            token = token,
            customerId = body.customerId,
            fullName = body.fullName,
            phone = normalisePhone(phone),
        )
        VerifyOutcome.Customer(isNewCustomer = body.isNewCustomer, fullName = body.fullName)
    }.getOrElse { VerifyOutcome.Error(it.message ?: "Network error") }

    /**
     * Cold-start session validity probe. 401 → token is revoked/invalid, clear
     * local state and report signed-out. 200 → live. A transient network error
     * keeps the session (optimistic offline) — the next authed call re-checks.
     */
    suspend fun checkSession(): Boolean = runCatching {
        if (!authStore.isSignedIn()) return@runCatching false
        val res = pulseApi.sessionCheck()
        if (res.code() == 401) {
            authStore.clear()
            return@runCatching false
        }
        true
    }.getOrElse { true }

    suspend fun signOut() {
        // Best-effort server revoke (bearer attached by the interceptor), then
        // wipe local state regardless.
        runCatching { authApi.signout() }
        authStore.clear()
    }

    fun markOnboardingDone() {
        authStore.onboardingDone = true
    }

    fun isOnboardingDone(): Boolean = authStore.onboardingDone

    private fun normalisePhone(input: String): String {
        val digits = input.filter { it.isDigit() }
        return if (digits.length == 10) "+91$digits" else input
    }

    private fun deviceLabel(): String {
        val make = Build.MANUFACTURER?.replaceFirstChar { it.uppercase() }.orEmpty()
        val model = Build.MODEL.orEmpty()
        val label = listOf(make, model).filter { it.isNotBlank() }.joinToString(" ").trim()
        return label.ifBlank { "Android device" }.take(120)
    }

    private fun parseError(body: String?): String {
        if (body.isNullOrBlank()) return "Request failed"
        val key = "\"error\""
        val i = body.indexOf(key)
        if (i < 0) return "Request failed"
        val start = body.indexOf('"', i + key.length + 1)
        val end = body.indexOf('"', start + 1)
        if (start < 0 || end < 0) return "Request failed"
        return body.substring(start + 1, end)
    }
}
