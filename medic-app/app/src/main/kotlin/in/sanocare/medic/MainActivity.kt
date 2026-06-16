package `in`.sanocare.medic

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Scaffold
import androidx.compose.ui.Modifier
import dagger.hilt.android.AndroidEntryPoint
import `in`.sanocare.medic.theme.SanocareMedicTheme
import `in`.sanocare.medic.ui.AuthGate

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            SanocareMedicTheme {
                Scaffold(modifier = Modifier.fillMaxSize()) { padding ->
                    AuthGate(contentPadding = padding)
                }
            }
        }
    }
}
