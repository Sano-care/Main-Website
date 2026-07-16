// PB1 — root project build script. Plugins applied per-module via the alias
// pattern (mirrors medic-app); this file only declares the plugin coordinates so
// the version catalog resolves.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.hilt) apply false
}
