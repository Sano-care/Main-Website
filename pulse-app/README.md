# Sanocare Pulse — Android (patient app)

Native Kotlin / Jetpack Compose patient app. **PB1 = foundation + auth only**
(theme + design system, phone→OTP-on-WhatsApp→session, app shell, Home with the
4 outcome tiles as stubs, first-run onboarding). Records / booking / video land
in PB2–PB4.

Mirrors the `medic-app/` toolchain so both apps build on the same platform:
Kotlin 2.0.21 · AGP 8.10.0 · Gradle 8.11.1 · Compose BoM 2024.12.01 · Hilt 2.52 ·
KSP 2.0.21-1.0.27 · Retrofit 2.11 / OkHttp 4.12. Min SDK 26, compile/target 36.

## Auth model (differs from the web + medic app)

The web patient session is a stateless HMAC-signed **cookie**; the medic app uses
that cookie via a CookieJar. The Pulse app instead uses an **opaque bearer
token**:

- On `POST /api/auth/verify-otp` the app sends `X-Sanocare-Client: android-pulse`
  (+ a `device_label`). The server mints a 256-bit token, stores it **sha256-
  hashed** in `mobile_session_tokens` (bound to `customer_id`, indefinite,
  revoke-only), and returns it once as `mobile_token`.
- The token is persisted in **EncryptedSharedPreferences** (`auth_prefs`,
  excluded from cloud backup / device-transfer) and attached as
  `Authorization: Bearer <token>` on every request by `BearerAuthInterceptor`.
- The shared server resolver `requirePulseCustomer` accepts the bearer OR the web
  cookie — one code path, two credential sources. `POST /api/pulse/signout` with
  a bearer sets `revoked_at`; the next call 401s → the app returns to login.
- The token is a credential: never logged (OkHttp logging is pinned to BASIC with
  `Authorization` redacted).

A Sanocare-staff number returns `role:"medic"` and no patient token — the OTP
screen shows "please use the Medic app" (accepted v1 limitation).

## Build

Requires a JDK 17+ (Android Studio's bundled JBR works) and an Android SDK with
platform 36. Point Gradle at the SDK via `pulse-app/local.properties`
(git-ignored, per-machine):

```
sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk
```

Then:

```
cd pulse-app
export JAVA_HOME="/path/to/jdk"        # e.g. Android Studio/jbr
./gradlew :app:assembleDebug           # -> app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:assembleRelease         # R8 + arm64-v8a split, debug-signed (pilot)
```

The release build mirrors medic-app: R8 full mode + `arm64-v8a`-only split, signed
with the debug key for the pilot (a dedicated release keystore is deferred to the
Play step).

## Layout

```
theme/            Compose brand theme (Color / Type / Theme) from the mockup tokens
data/auth/        PulseAuthStore (EncryptedSharedPreferences) · AuthRepository · models
data/network/     Retrofit + OkHttp (BearerAuthInterceptor) · Auth/Pulse APIs
ui/components/     SanocareLogo (lockup) + PrimaryButton/GhostButton/PhoneField/OtpBoxes/…
ui/login/          Concept A login + shared OTP + AuthViewModel + LoginFlow
ui/onboarding/     Stay-signed-in consent + skippable add-family
ui/shell/          MainShell — top bar + drawer + member-switcher sheet
ui/home/           Home — greeting + 4 outcome tiles + emergency ribbon + snapshot stubs
ui/AuthGate.kt     Cold-start session probe → login / onboarding / shell
```
