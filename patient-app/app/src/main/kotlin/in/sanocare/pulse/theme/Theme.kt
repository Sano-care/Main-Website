package `in`.sanocare.pulse.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val SanocareLightColorScheme = lightColorScheme(
    primary = SanocareBlue,
    onPrimary = Paper,
    primaryContainer = SanocareBlueDark,
    onPrimaryContainer = Paper,
    secondary = SanocareCoral,
    onSecondary = Paper,
    background = Paper,
    onBackground = InkPrimary,
    surface = Paper,
    onSurface = InkPrimary,
    surfaceVariant = PaperMute,
    onSurfaceVariant = InkSecondary,
    outline = BorderHair,
    outlineVariant = BorderHair,
)

// v0 ships light-only — Sanocare brand spec is "newspaper, not nightclub";
// dark mode is a v0.1+ consideration if pilot medics ask.
@Composable
fun SanocarePulseTheme(
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = SanocareLightColorScheme,
        typography = sanocareTypography(),
    ) {
        Surface(content = content)
    }
}
