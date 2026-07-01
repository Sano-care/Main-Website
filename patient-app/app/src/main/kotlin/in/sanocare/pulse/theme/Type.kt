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

// Brand discipline: Inter for everything; IBM Plex Mono ONLY for numbers,
// codes, and timestamps (per Sanocare_Marketing_Context/02_Brand_Identity.md).
// `sanocareMonoFamily` is exposed for those mono-only callers (BookingDetailScreen
// timestamps, PayoutScreen amounts, etc. land in later phases).

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
    val baseStyle = TextStyle(
        fontFamily = SanocareInterFamily,
        fontStyle = FontStyle.Normal,
    )
    return Typography(
        displayLarge = baseStyle.copy(fontSize = 36.sp, fontWeight = FontWeight.Bold),
        displayMedium = baseStyle.copy(fontSize = 30.sp, fontWeight = FontWeight.SemiBold),
        headlineLarge = baseStyle.copy(fontSize = 26.sp, fontWeight = FontWeight.SemiBold),
        headlineMedium = baseStyle.copy(fontSize = 22.sp, fontWeight = FontWeight.SemiBold),
        titleLarge = baseStyle.copy(fontSize = 20.sp, fontWeight = FontWeight.SemiBold),
        titleMedium = baseStyle.copy(fontSize = 16.sp, fontWeight = FontWeight.Medium),
        bodyLarge = baseStyle.copy(fontSize = 16.sp, fontWeight = FontWeight.Normal),
        bodyMedium = baseStyle.copy(fontSize = 14.sp, fontWeight = FontWeight.Normal),
        labelLarge = baseStyle.copy(fontSize = 14.sp, fontWeight = FontWeight.SemiBold),
        labelMedium = baseStyle.copy(fontSize = 12.sp, fontWeight = FontWeight.SemiBold),
    )
}
