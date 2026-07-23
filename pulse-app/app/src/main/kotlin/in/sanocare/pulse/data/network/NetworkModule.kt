package `in`.sanocare.pulse.data.network

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import javax.inject.Singleton

// PB1 — OkHttp + Retrofit Hilt bindings. Talks to production sanocare.in (no
// local dev server in the app build pipeline; matches medic-app).
//
// Auth is bearer-token based (BearerAuthInterceptor), NOT cookies — the native
// app never carries the web session cookie.
//
// Logging is pinned to BASIC (request line + response line only). We deliberately
// do NOT log headers or bodies: the Authorization header and the verify-otp
// response's mobile_token are credentials and must never reach logs (DPDP).

private const val BASE_URL = "https://sanocare.in/"

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun provideJson(): Json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
    }

    @Provides
    @Singleton
    fun provideOkHttp(bearerAuth: BearerAuthInterceptor): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            // BASIC only — no headers, no bodies. Keeps the token out of logs.
            level = HttpLoggingInterceptor.Level.BASIC
            redactHeader("Authorization")
        }
        return OkHttpClient.Builder()
            .addInterceptor(bearerAuth)
            .addInterceptor(logging)
            .build()
    }

    @Provides
    @Singleton
    fun provideRetrofit(client: OkHttpClient, json: Json): Retrofit {
        val contentType = "application/json".toMediaType()
        return Retrofit.Builder()
            .baseUrl(BASE_URL)
            .client(client)
            .addConverterFactory(json.asConverterFactory(contentType))
            .build()
    }

    @Provides
    @Singleton
    fun provideAuthApi(retrofit: Retrofit): AuthApi = retrofit.create(AuthApi::class.java)

    @Provides
    @Singleton
    fun providePulseApi(retrofit: Retrofit): PulseApi = retrofit.create(PulseApi::class.java)

    @Provides
    @Singleton
    fun provideRecordsApi(retrofit: Retrofit): RecordsApi = retrofit.create(RecordsApi::class.java)

    @Provides
    @Singleton
    fun providePulseWriteApi(retrofit: Retrofit): PulseWriteApi = retrofit.create(PulseWriteApi::class.java)

    @Provides
    @Singleton
    fun providePulseExtraApi(retrofit: Retrofit): PulseExtraApi = retrofit.create(PulseExtraApi::class.java)

    @Provides
    @Singleton
    fun provideTeleconsultApi(retrofit: Retrofit): TeleconsultApi = retrofit.create(TeleconsultApi::class.java)
}
