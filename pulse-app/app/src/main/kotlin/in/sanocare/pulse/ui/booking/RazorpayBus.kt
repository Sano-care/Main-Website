package `in`.sanocare.pulse.ui.booking

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

// PB4a — bridge between the Razorpay Checkout Activity callbacks (delivered to
// MainActivity via PaymentResultWithDataListener) and the Compose booking flow.
//
// Razorpay's result comes back on the Activity, not through a Compose channel, so
// MainActivity publishes here and the booking screen collects. replay = 0 with a
// 1-slot buffer (DROP_OLDEST) means: the booking screen's collector stays
// subscribed while the Razorpay activity is on top (its composition isn't
// destroyed), so it receives the result; if a result somehow arrives before the
// collector, it's buffered rather than lost.

object RazorpayBus {
    private val _events = MutableSharedFlow<RazorpayResult>(
        replay = 0,
        extraBufferCapacity = 1,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val events = _events.asSharedFlow()

    fun publish(result: RazorpayResult) {
        _events.tryEmit(result)
    }
}

sealed interface RazorpayResult {
    /** Payment captured — carries the fields the server verify needs. */
    data class Success(
        val orderId: String,
        val paymentId: String,
        val signature: String,
    ) : RazorpayResult

    /** User cancelled or the SDK reported an error (no capture). */
    data class Failed(val message: String) : RazorpayResult
}
