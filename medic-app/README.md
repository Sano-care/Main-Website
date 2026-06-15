# Sanocare Medic App

Native Android app (Kotlin + Jetpack Compose) for Sanocare medics. Lives
inside the `Main-Website` monorepo at `medic-app/` per the T65 brief.

## Brief

Canonical: `~/OneDrive/Desktop/Sanocare/T65_Medic_App_v0_CC_Brief.md`
(brief lock 2026-06-15). Phase-by-phase plan in §9.

## Quick start

### Android Studio

1. Open the `medic-app/` directory directly in Android Studio (NOT the
   repo root — the Gradle project lives one level down).
2. Wait for the Gradle sync. First sync downloads ~200MB of dependencies
   into your Gradle cache.
3. Run the `app` configuration on an emulator or physical device.

### CLI

```bash
cd medic-app
./gradlew :app:assembleDebug
# APK at app/build/outputs/apk/debug/app-debug.apk
```

Set `local.properties` `sdk.dir` to your Android SDK if Gradle can't
auto-resolve `ANDROID_HOME`.

## Locked tool versions

See `gradle/libs.versions.toml`. The catalog is the single source of
truth for version bumps.

| Tool | Version |
|---|---|
| Kotlin | 2.0.21 |
| AGP | 8.10.0 |
| Gradle | 8.10.2 |
| Compose BoM | 2024.12.01 |
| Hilt | 2.52 |
| KSP | 2.0.21-1.0.27 |
| Min SDK | 26 (Android 8) |
| Compile + Target SDK | 36 (Android 16) |
| JDK | 17 or higher |

## Phase 0 scope (this commit)

- Gradle Kotlin DSL project with version catalog
- Material 3 theme + Sanocare brand tokens (Compose)
- Google Fonts downloadable: Inter + IBM Plex Mono
- `MedicApp` Hilt-enabled Application class
- `MainActivity` Compose entry
- `LoginFlow` navigation: `PhoneEntryScreen` → `OtpEntryScreen`
  (UI shell only — Phase 1 wires real OTP routes)
- Placeholder `google-services.json` for FCM SDK init (real config
  swaps in Phase 4)

No network calls, no DI bindings yet, no auth gate. Pure scaffold.

## Phase roadmap

Per brief §9:

- **Phase 0** — Scaffolding (this commit)
- **Phase 1** — Auth + Attendance (M049 + M050)
- **Phase 2** — Duty list + Booking detail + 4-event POST (M051 + M052)
- **Phase 3** — Video calls (Daily.co Android SDK)
- **Phase 4** — Push notifications (FCM + real google-services.json)
- **Phase 5** — Payouts (M053 medic_ledger)
- **Phase 6** — Polish + signed APK + distribution

## Distribution

v0 ships unsigned debug APKs over WhatsApp / Drive to founder + pilot
medics. Google Play Internal Testing track at v0.1+. See brief §10.
