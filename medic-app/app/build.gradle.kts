// T65 — Sanocare Medic App :app module
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
    alias(libs.plugins.google.services)
}

android {
    namespace = "in.sanocare.medic"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        applicationId = "in.sanocare.medic"
        minSdk = libs.versions.minSdk.get().toInt()
        targetSdk = libs.versions.targetSdk.get().toInt()
        versionCode = 9
        versionName = "0.6.1"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables { useSupportLibrary = true }
    }

    buildTypes {
        release {
            // R8 full mode: shrink + obfuscate code (the ~60 MB of unminified
            // debug DEX is the big win) and strip unused resources, to fit the
            // 50 MB Supabase Free Storage upload cap. Keep-rules in
            // proguard-rules.pro protect kotlinx.serialization + Retrofit.
            isMinifyEnabled = true
            isShrinkResources = true
            // release is NOT debuggable (default; stated for clarity).
            isDebuggable = false
            // Signing — Option B (founder, 2026-06-23): sign the release with the
            // existing DEBUG key for this pilot, so in-place updates keep working
            // for current installs. A dedicated release keystore is deferred to
            // the Google Play step. No keystore is created or committed here.
            signingConfig = signingConfigs.getByName("debug")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            // No suffix — debug build stays unminified for fast iteration.
            isDebuggable = true
        }
    }

    // ABI split — the universal minified APK is ~58 MB (Daily.co native libs across
    // 4 ABIs). For the Supabase Free 50 MB cap we distribute an arm64-v8a-only APK,
    // which drops the emulator (x86/x86_64) and legacy 32-bit (armeabi-v7a) native
    // libs. arm64-v8a covers virtually every current phone; very old 32-bit-only
    // devices are intentionally out of scope for the pilot. Produces
    //   app/build/outputs/apk/release/app-arm64-v8a-release.apk
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
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.hilt.navigation.compose)

    // Hilt
    implementation(libs.hilt.android)
    ksp(libs.hilt.android.compiler)

    // Networking
    implementation(libs.retrofit)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging.interceptor)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.retrofit.kotlinx.serialization.converter)

    // Firebase Cloud Messaging (placeholder google-services.json until Phase 4)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)

    // Daily.co video SDK (Phase 3 wires the embedded call surface)
    implementation(libs.daily.client)

    // Fused location — attendance clock-in coords (Phase 1 C4)
    implementation(libs.play.services.location)
}
