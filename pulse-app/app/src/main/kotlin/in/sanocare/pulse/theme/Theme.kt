package `in`.sanocare.pulse.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val SanocareLightColorScheme = lightColorScheme(
    primary = SanocareBlue,
    onPrimary = Paper,
    primaryContainer = SanocareBlueSoft,
    onPrimaryContainer = SanocareBlueDark,
    secondary = SanocareCoral,
    onSecondary = Paper,
    secondaryContainer = SanocareCoralSoft,
    onSecondaryContainer = InkPrimary,
    background = Paper,
    onBackground = InkPrimary,
    surface = Paper,
    onSurface = InkPrimary,
    surfaceVariant = PaperMute,
    onSurfaceVariant = InkSecondary,
    outline = BorderHair,
    outlineVariant = BorderHair,
    error = SanocareCoral,
)

// Light-only for PB1 — brand spec is "newspaper, not nightclub". Dark mode is a
// later consideration.
@Composable
fun SanocarePulseTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = SanocareLightColorScheme,
        typography = sanocareTypography(),
    ) {
        Surface(content = content)
    }
}
