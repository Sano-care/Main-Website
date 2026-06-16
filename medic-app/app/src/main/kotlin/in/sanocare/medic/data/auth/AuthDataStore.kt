package `in`.sanocare.medic.data.auth

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

// T65 Phase 1 — DataStore-backed persistence for the medic session cookie
// + cached profile (full_name / qualification / medic_id). The cookie IS
// the auth boundary; profile fields are convenience for the Me tab so we
// don't refetch on every cold start.
//
// Persistence model: a single Preferences DataStore named "auth". Cookie
// is stored as `name=value` (raw header form) so re-injection in
// SanocareCookieJar is a one-line cookie parse.

private val Context.authDataStore by preferencesDataStore(name = "auth")

@Singleton
class AuthDataStore @Inject constructor(
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: Context,
) {
    private val store get() = context.authDataStore

    // Persisted session cookie value in `name=value` form (e.g.
    // "sanocare_medic_verify=eyJ..."). Empty string = signed out.
    suspend fun getCookie(): String = store.data.first()[KEY_COOKIE].orEmpty()
    suspend fun setCookie(cookie: String) {
        store.edit { it[KEY_COOKIE] = cookie }
    }
    suspend fun clearCookie() {
        store.edit { it.remove(KEY_COOKIE) }
    }

    val cookieFlow: Flow<String> = store.data.map { it[KEY_COOKIE].orEmpty() }

    // Cached medic profile — written on verify-otp success + /me response,
    // read by the Me tab + MainShell top bar on cold start.
    suspend fun setProfile(medicId: String, fullName: String, qualification: String) {
        store.edit {
            it[KEY_MEDIC_ID] = medicId
            it[KEY_FULL_NAME] = fullName
            it[KEY_QUALIFICATION] = qualification
        }
    }
    suspend fun clearProfile() {
        store.edit {
            it.remove(KEY_MEDIC_ID)
            it.remove(KEY_FULL_NAME)
            it.remove(KEY_QUALIFICATION)
        }
    }

    val profileFlow: Flow<CachedProfile?> = store.data.map { prefs ->
        val id = prefs[KEY_MEDIC_ID] ?: return@map null
        val name = prefs[KEY_FULL_NAME] ?: return@map null
        val qual = prefs[KEY_QUALIFICATION] ?: return@map null
        CachedProfile(medicId = id, fullName = name, qualification = qual)
    }

    private companion object {
        val KEY_COOKIE: Preferences.Key<String> = stringPreferencesKey("medic_cookie")
        val KEY_MEDIC_ID: Preferences.Key<String> = stringPreferencesKey("medic_id")
        val KEY_FULL_NAME: Preferences.Key<String> = stringPreferencesKey("medic_full_name")
        val KEY_QUALIFICATION: Preferences.Key<String> = stringPreferencesKey("medic_qualification")
    }
}

data class CachedProfile(
    val medicId: String,
    val fullName: String,
    val qualification: String,
)
