package `in`.sanocare.pulse

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.core.view.WindowCompat
import com.razorpay.Checkout
import com.razorpay.PaymentData
import com.razorpay.PaymentResultWithDataListener
import dagger.hilt.android.AndroidEntryPoint
import `in`.sanocare.pulse.theme.SanocarePulseTheme
import `in`.sanocare.pulse.ui.AuthGate
import `in`.sanocare.pulse.ui.booking.RazorpayBus
import `in`.sanocare.pulse.ui.booking.RazorpayResult

// PB4a — MainActivity also hosts the Razorpay Checkout result callbacks. The SDK
// delivers success/error to the launching Activity (not a Compose channel), so we
// forward them to RazorpayBus, which the teleconsult booking screen collects. The
// app never sees the Razorpay secret — only the captured order/payment/signature,
// which the server re-verifies.
@AndroidEntryPoint
class MainActivity : ComponentActivity(), PaymentResultWithDataListener {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Quiet-white surfaces → dark status-bar icons so the clock/battery stay
        // legible over Paper. (Android 15 forces edge-to-edge; we pad content for
        // the bars per-screen with statusBarsPadding/navigationBarsPadding.)
        WindowCompat.getInsetsController(window, window.decorView)
            .isAppearanceLightStatusBars = true
        // Warm up the Razorpay checkout (faster first sheet open). No-op network.
        Checkout.preload(applicationContext)
        setContent {
            SanocarePulseTheme {
                // AuthGate owns the top-level surface (login / onboarding / shell)
                // and edge-to-edge insets, so it fills the whole window.
                AuthGate(modifier = Modifier.fillMaxSize())
            }
        }
    }

    override fun onPaymentSuccess(razorpayPaymentId: String?, data: PaymentData?) {
        RazorpayBus.publish(
            RazorpayResult.Success(
                orderId = data?.orderId.orEmpty(),
                paymentId = data?.paymentId ?: razorpayPaymentId.orEmpty(),
                signature = data?.signature.orEmpty(),
            ),
        )
    }

    override fun onPaymentError(code: Int, response: String?, data: PaymentData?) {
        val message = when (code) {
            Checkout.PAYMENT_CANCELED -> "Payment cancelled."
            Checkout.NETWORK_ERROR -> "Network error during payment. Please try again."
            else -> "Payment didn't go through. Please try again."
        }
        RazorpayBus.publish(RazorpayResult.Failed(message))
    }
}
