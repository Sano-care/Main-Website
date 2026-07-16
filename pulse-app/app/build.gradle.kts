// PB1 — Sanocare Pulse :app module. Mirrors the medic-app build (R8 full mode +
// arm64-v8a split + debug signing for the pilot). No Daily/Firebase/location.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

android {
    namespace = "in.sanocare.pulse"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        applicationId = "in.sanocare.pulse"
        minSdk = libs.versions.minSdk.get().toInt()
        targetSdk = libs.versions.targetSdk.get().toInt()
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables { useSupportLibrary = true }
    }

    buildTypes {
        release {
            // R8 full mode — shrink + obfuscate + strip resources. Keep-rules in
            // proguard-rules.pro protect kotlinx.serialization + Retrofit DTOs.
            isMinifyEnabled = true
            isShrinkResources = true
            isDebuggable = false
            // Sign the release with the DEBUG key for the pilot (matches medic-app
            // Option B) so in-place updates keep working. A dedicated release
            // keystore is deferred to the Play step. No keystore committed here.
            signingConfig = signingConfigs.getByName("debug")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            isDebuggable = true
        }
    }

    // arm64-v8a-only split (mirrors medic-app) — keeps the APK small and within
    // the Supabase Free 50 MB upload cap for the pilot distribution.
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a")
            isUniversalApk = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    sourceSets {
        getByName("main") {
            java.srcDirs("src/main/kotlin")
        }
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    // Compose (BoM-aligned)
    val composeBom = platform(libs.compose.bom)
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.compose.navigation)
    implementation(libs.compose.ui.text.google.fonts)

    debugImplementation(libs.compose.ui.tooling)

    // AndroidX
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.hilt.navigation.compose)

    // Jetpack Security — EncryptedSharedPreferences for the bearer token.
    implementation(libs.androidx.security.crypto)

    // Chrome Custom Tabs — public-token Rx/report pages (PB2).
    implementation(libs.androidx.browser)

    // Hilt
    implementation(libs.hilt.android)
    ksp(libs.hilt.android.compiler)

    // Networking
    implementation(libs.retrofit)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging.interceptor)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.retrofit.kotlinx.serialization.converter)
}
