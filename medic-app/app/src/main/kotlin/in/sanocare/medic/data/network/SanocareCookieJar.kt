package `in`.sanocare.medic.data.network

import `in`.sanocare.medic.data.auth.AuthDataStore
import kotlinx.coroutines.runBlocking
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import javax.inject.Inject
import javax.inject.Singleton

// T65 Phase 1 — single-cookie CookieJar backed by DataStore. We only care
// about the medic session cookie (sanocare_medic_verify). Other cookies
// from the response are ignored.
//
// runBlocking is safe here: OkHttp's CookieJar API is synchronous and we're
// already on a worker thread (OkHttp dispatcher). DataStore reads are
// fast (single-key suspending read). The alternative — a parallel
// in-memory cache + async write — adds complexity for no behaviour gain.

@Singleton
class SanocareCookieJar @Inject constructor(
    private val authDataStore: AuthDataStore,
) : CookieJar {

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val medicCookie = cookies.firstOrNull { it.name == MEDIC_COOKIE_NAME } ?: return
        runBlocking {
            authDataStore.setCookie("${medicCookie.name}=${medicCookie.value}")
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val raw = runBlocking { authDataStore.getCookie() }
        if (raw.isBlank()) return emptyList()
        val eq = raw.indexOf('=')
        if (eq <= 0) return emptyList()
        val name = raw.substring(0, eq)
        val value = raw.substring(eq + 1)
        if (name != MEDIC_COOKIE_NAME) return emptyList()
        // host-only, secure, sameSite-lax — match how the server sets it
        // so OkHttp accepts the cookie domain check on the next request.
        val cookie = Cookie.Builder()
            .name(name)
            .value(value)
            .domain(url.host)
            .path("/")
            .secure()
            .httpOnly()
            .build()
        return listOf(cookie)
    }

    companion object {
        const val MEDIC_COOKIE_NAME = "sanocare_medic_verify"
    }
}
