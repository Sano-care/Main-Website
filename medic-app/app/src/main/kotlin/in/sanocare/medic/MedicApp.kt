package `in`.sanocare.medic

import android.app.Application
import dagger.hilt.android.HiltAndroidApp

// Phase 0: Hilt-managed Application. Singletons (Retrofit, OkHttp,
// DataStore, AuthRepository, etc.) get bound via @Module in later phases.
@HiltAndroidApp
class MedicApp : Application()
