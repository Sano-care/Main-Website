package `in`.sanocare.medic.data.network

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

// T65 Phase 1 — OkHttp + Retrofit Hilt bindings.
//
// Base URL is hardcoded to production sanocare.in. We're not running a
// local Next.js dev server for the medic-app build pipeline (would need
// emulator-host bridge + cert acceptance) — v0 talks to prod for
// founder UAT. A future phase adds BuildConfig flavors for staging.

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
    fun provideOkHttp(cookieJar: SanocareCookieJar): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            // Body level on debug builds to surface verify-otp payloads;
            // headers-only on release would be safer once Phase 6 lands.
            level = HttpLoggingInterceptor.Level.BODY
        }
        return OkHttpClient.Builder()
            .cookieJar(cookieJar)
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
    fun provideAttendanceApi(retrofit: Retrofit): AttendanceApi =
        retrofit.create(AttendanceApi::class.java)

    @Provides
    @Singleton
    fun provideLocationApi(retrofit: Retrofit): LocationApi =
        retrofit.create(LocationApi::class.java)

    @Provides
    @Singleton
    fun provideDutyApi(retrofit: Retrofit): DutyApi =
        retrofit.create(DutyApi::class.java)

    @Provides
    @Singleton
    fun providePayoutsApi(retrofit: Retrofit): PayoutsApi =
        retrofit.create(PayoutsApi::class.java)
}
