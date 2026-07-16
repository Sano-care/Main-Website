package `in`.sanocare.pulse.data.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

// PB1 — the ONLY persistence of the bearer session token, in an
// EncryptedSharedPreferences file (Jetpack Security; AES-256, Android Keystore-
// backed master key). The file name is "auth_prefs" — matching the exclude in
// backup_rules.xml / data_extraction_rules.xml so the token never leaves the
// device via cloud backup or device-transfer.
//
// The raw token is a credential: it is written here on verify-otp and read by
// BearerAuthInterceptor to attach `Authorization: Bearer`. It is NEVER logged.
// Cached name/customer_id are convenience for the shell top bar on cold start.

@Singleton
class PulseAuthStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs: SharedPreferences = run {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            PREFS_FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    /** The bearer token, or null when signed out. */
    val token: String? get() = prefs.getString(KEY_TOKEN, null)

    fun isSignedIn(): Boolean = !token.isNullOrBlank()

    /** Persist the session after a successful verify-otp. */
    fun saveSession(token: String, customerId: String?, fullName: String?) {
        prefs.edit()
            .putString(KEY_TOKEN, token)
            .putString(KEY_CUSTOMER_ID, customerId)
            .putString(KEY_FULL_NAME, fullName)
            .apply()
    }

    fun updateFullName(fullName: String?) {
        prefs.edit().putString(KEY_FULL_NAME, fullName).apply()
    }

    val customerId: String? get() = prefs.getString(KEY_CUSTOMER_ID, null)
    val fullName: String? get() = prefs.getString(KEY_FULL_NAME, null)

    /** Whether the first-run onboarding has been completed on this device. */
    var onboardingDone: Boolean
        get() = prefs.getBoolean(KEY_ONBOARDING_DONE, false)
        set(value) = prefs.edit().putBoolean(KEY_ONBOARDING_DONE, value).apply()

    /** Wipe everything on sign-out. */
    fun clear() {
        prefs.edit().clear().apply()
    }

    private companion object {
        const val PREFS_FILE = "auth_prefs"
        const val KEY_TOKEN = "bearer_token"
        const val KEY_CUSTOMER_ID = "customer_id"
        const val KEY_FULL_NAME = "full_name"
        const val KEY_ONBOARDING_DONE = "onboarding_done"
    }
}
