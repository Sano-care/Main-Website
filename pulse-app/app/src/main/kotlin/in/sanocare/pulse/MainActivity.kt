package `in`.sanocare.pulse

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.core.view.WindowCompat
import dagger.hilt.android.AndroidEntryPoint
import `in`.sanocare.pulse.theme.SanocarePulseTheme
import `in`.sanocare.pulse.ui.AuthGate

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Quiet-white surfaces → dark status-bar icons so the clock/battery stay
        // legible over Paper. (Android 15 forces edge-to-edge; we pad content for
        // the bars per-screen with statusBarsPadding/navigationBarsPadding.)
        WindowCompat.getInsetsController(window, window.decorView)
            .isAppearanceLightStatusBars = true
        setContent {
            SanocarePulseTheme {
                // AuthGate owns the top-level surface (login / onboarding / shell)
                // and edge-to-edge insets, so it fills the whole window.
                AuthGate(modifier = Modifier.fillMaxSize())
            }
        }
    }
}
