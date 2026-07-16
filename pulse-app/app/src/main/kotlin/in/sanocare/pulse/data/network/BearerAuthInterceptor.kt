package `in`.sanocare.pulse.data.network

import `in`.sanocare.pulse.data.auth.PulseAuthStore
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

// PB1 — attaches the two headers the Sanocare API needs from the native app:
//
//   * `X-Sanocare-Client: android-pulse` on every request — tells /api/auth/
//     verify-otp to also mint a bearer token (the server gates the mint on this
//     header; see src/lib/otp/mobileToken.ts).
//   * `Authorization: Bearer <token>` when a session exists — how the shared
//     requirePulseCustomer resolver identifies the caller (parallel to the web
//     cookie). Omitted for the pre-login send-otp / verify-otp calls.
//
// The token is read from EncryptedSharedPreferences on each request (cheap; this
// runs on the OkHttp worker thread). The token value is NEVER logged — the
// logging interceptor is configured to redact the Authorization header.

@Singleton
class BearerAuthInterceptor @Inject constructor(
    private val authStore: PulseAuthStore,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val builder = chain.request().newBuilder()
            .header(MOBILE_CLIENT_HEADER, MOBILE_CLIENT_VALUE)

        val token = authStore.token
        if (!token.isNullOrBlank()) {
            builder.header("Authorization", "Bearer $token")
        }
        return chain.proceed(builder.build())
    }

    companion object {
        const val MOBILE_CLIENT_HEADER = "X-Sanocare-Client"
        const val MOBILE_CLIENT_VALUE = "android-pulse"
    }
}
