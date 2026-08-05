package `in`.sanocare.pulse

import android.app.Application
import dagger.hilt.android.HiltAndroidApp

// Phase 0: Hilt-managed Application. Singletons (Retrofit, OkHttp, DataStore,
// AuthRepository, etc.) get bound via @Module in Phase 1 when networking lands.
@HiltAndroidApp
class PulseApp : Application()
