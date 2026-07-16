package `in`.sanocare.pulse.theme

import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.googlefonts.Font
import androidx.compose.ui.text.googlefonts.GoogleFont
import androidx.compose.ui.unit.sp
import `in`.sanocare.pulse.R

// Brand discipline (02_Brand_Identity.md): Inter for all UI; IBM Plex Mono ONLY
// for numbers, codes, and IDs. SanocareMonoFamily is exposed for those callers
// (the +91 prefix, OTP boxes, and any code/ID surfaces).

private val googleFontsProvider = GoogleFont.Provider(
    providerAuthority = "com.google.android.gms.fonts",
    providerPackage = "com.google.android.gms",
    certificates = R.array.com_google_android_gms_fonts_certs,
)

private val interGoogleFont = GoogleFont("Inter")
private val plexMonoGoogleFont = GoogleFont("IBM Plex Mono")

val SanocareInterFamily = FontFamily(
    Font(googleFont = interGoogleFont, fontProvider = googleFontsProvider, weight = FontWeight.Normal),
    Font(googleFont = interGoogleFont, fontProvider = googleFontsProvider, weight = FontWeight.Medium),
    Font(googleFont = interGoogleFont, fontProvider = googleFontsProvider, weight = FontWeight.SemiBold),
    Font(googleFont = interGoogleFont, fontProvider = googleFontsProvider, weight = FontWeight.Bold),
)

val SanocareMonoFamily = FontFamily(
    Font(googleFont = plexMonoGoogleFont, fontProvider = googleFontsProvider, weight = FontWeight.Normal),
    Font(googleFont = plexMonoGoogleFont, fontProvider = googleFontsProvider, weight = FontWeight.Medium),
    Font(googleFont = plexMonoGoogleFont, fontProvider = googleFontsProvider, weight = FontWeight.SemiBold),
)

@Composable
fun sanocareTypography(): Typography {
    val base = TextStyle(fontFamily = SanocareInterFamily, fontStyle = FontStyle.Normal)
    return Typography(
        displayLarge = base.copy(fontSize = 36.sp, fontWeight = FontWeight.Bold),
        displayMedium = base.copy(fontSize = 30.sp, fontWeight = FontWeight.Bold),
        // Concept A headline ~25sp, Inter 700.
        headlineLarge = base.copy(fontSize = 25.sp, fontWeight = FontWeight.Bold, lineHeight = 31.sp),
        headlineMedium = base.copy(fontSize = 22.sp, fontWeight = FontWeight.SemiBold),
        titleLarge = base.copy(fontSize = 20.sp, fontWeight = FontWeight.SemiBold),
        titleMedium = base.copy(fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
        bodyLarge = base.copy(fontSize = 16.sp, fontWeight = FontWeight.Normal, lineHeight = 23.sp),
        bodyMedium = base.copy(fontSize = 14.sp, fontWeight = FontWeight.Normal, lineHeight = 20.sp),
        labelLarge = base.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
        labelMedium = base.copy(fontSize = 12.sp, fontWeight = FontWeight.Medium),
    )
}
