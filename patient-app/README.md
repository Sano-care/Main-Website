# Sanocare Pulse — Android (patient app)

Native Android client for patients, sibling to `medic-app/` in this monorepo.
Same toolchain + brand; different package (`in.sanocare.pulse`), audience
(patients), and auth model (**open signup** — any phone can register).

Reuses the existing web Pulse backend (`/api/auth/send-otp`,
`/api/auth/verify-otp`, `/api/pulse/*`) — **no new backend routes, no schema
migrations**.

## Status — Phase 0 (scaffolding)
Installable APK that opens to a brand-correct **LoginFlow** shell
(PhoneEntryScreen ⇄ OtpEntryScreen), UI-only (no network). Proves a second
Android app coexists with Sanocare Medic in the monorepo + app drawer.

## Stack (locked at T65 levels)
Kotlin 2.0.21 · Jetpack Compose (BoM 2024.11.00) · Material 3 · Hilt 2.52 (KSP)
· Retrofit/OkHttp/Kotlinx Serialization (wired in Phase 1) · AGP 8.10.0 ·
Gradle 8.11.1 · minSdk 26 (Android 8+) · compile/target SDK 36.

## Build
```bash
# JDK 17+ required (Android Studio's bundled JBR works).
# local.properties must point at your Android SDK (sdk.dir=...).
cd patient-app
./gradlew :app:assembleDebug
# APK -> app/build/outputs/apk/debug/app-debug.apk
```
Or open `patient-app/` in Android Studio and Run.

## Roadmap
- **Phase 0** - scaffolding + LoginFlow shell *(this)*
- Phase 1 - real OTP send/verify + DataStore session + 3-tab MainShell
- Phase 2 - booking flow
- Phase 4 - family members + FCM push
- Phase 5/6 - vitals/meds + records
