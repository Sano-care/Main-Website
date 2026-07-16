package `in`.sanocare.pulse

import android.app.Application
import dagger.hilt.android.HiltAndroidApp

// PB1 — Hilt-managed Application. Singletons (Retrofit, OkHttp, the
// EncryptedSharedPreferences-backed token store, AuthRepository) are bound via
// @Module.
@HiltAndroidApp
class PulseApp : Application()
