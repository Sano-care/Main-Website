package `in`.sanocare.pulse

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Scaffold
import androidx.compose.ui.Modifier
import dagger.hilt.android.AndroidEntryPoint
import `in`.sanocare.pulse.theme.SanocarePulseTheme
import `in`.sanocare.pulse.ui.login.LoginFlow

// Phase 0 entry point. Hosts the LoginFlow shell only — no auth state, no
// MainShell. Phase 1 introduces an AuthGate that routes verified users to the
// 3-tab MainShell.
@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            SanocarePulseTheme {
                Scaffold(modifier = Modifier.fillMaxSize()) { padding ->
                    LoginFlow(contentPadding = padding)
                }
            }
        }
    }
}
