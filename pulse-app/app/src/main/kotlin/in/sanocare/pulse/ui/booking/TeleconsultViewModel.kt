package `in`.sanocare.pulse.ui.booking

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.sanocare.pulse.data.booking.TeleconsultRepository
import `in`.sanocare.pulse.data.network.CreateOrderDto
import `in`.sanocare.pulse.data.network.TeleconsultConfigDto
import `in`.sanocare.pulse.data.records.MemberScopeStore
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import javax.inject.Inject

// PB4a — orchestrates the native teleconsult booking:
//   Form → createOrder() → (screen opens Razorpay sheet) → onPaymentSuccess →
//   verify() → Confirmed. Payment secret never touches the app; the app only
//   receives the publishable keyId from create-order and the captured order/
//   payment/signature back from the SDK, which the server re-verifies.

sealed interface TeleconsultPhase {
    data object Form : TeleconsultPhase
    /** Creating the order or verifying the payment — a spinner state. */
    data object Working : TeleconsultPhase
    data class Confirmed(val bookingCode: String?, val slotLabel: String) : TeleconsultPhase
    data class Failed(val message: String) : TeleconsultPhase
}

/** One-shot signal for the screen to open the Razorpay Checkout sheet. */
data class OpenCheckout(val order: CreateOrderDto, val prefillContact: String?)

@HiltViewModel
class TeleconsultViewModel @Inject constructor(
    private val repo: TeleconsultRepository,
    scope: MemberScopeStore,
) : ViewModel() {

    val members = scope.members

    private val _config = MutableStateFlow<TeleconsultConfigDto?>(null)
    val config: StateFlow<TeleconsultConfigDto?> = _config.asStateFlow()

    private val _phase = MutableStateFlow<TeleconsultPhase>(TeleconsultPhase.Form)
    val phase: StateFlow<TeleconsultPhase> = _phase.asStateFlow()

    private val _openCheckout = MutableSharedFlow<OpenCheckout>(extraBufferCapacity = 1)
    val openCheckout = _openCheckout.asSharedFlow()

    // ── form state ───────────────────────────────────────────────────────────
    /** null = self; otherwise a family_members.id. */
    var selectedMemberId by mutableStateOf<String?>(null)
    var address by mutableStateOf("")
    var earliest by mutableStateOf(true)
    /** Chosen instant (device local) when earliest == false. */
    var laterMillis by mutableStateOf<Long?>(null)
    var formError by mutableStateOf<String?>(null)
        private set

    init {
        viewModelScope.launch { _config.value = repo.config() }
    }

    fun submit(prefillContact: String?) {
        formError = null
        if (address.trim().length < 4) {
            formError = "Please enter an address (required for teleconsultation)."
            return
        }
        if (!earliest && laterMillis == null) {
            formError = "Pick a date and time, or choose Earliest."
            return
        }
        _phase.value = TeleconsultPhase.Working
        viewModelScope.launch {
            when (val r = repo.createOrder()) {
                is TeleconsultRepository.OrderResult.Ok ->
                    _openCheckout.emit(OpenCheckout(r.order, prefillContact))
                is TeleconsultRepository.OrderResult.Err ->
                    _phase.value = TeleconsultPhase.Failed(r.message)
            }
        }
    }

    fun onPaymentSuccess(orderId: String, paymentId: String, signature: String) {
        _phase.value = TeleconsultPhase.Working
        viewModelScope.launch {
            val scheduledIso =
                if (earliest) null else laterMillis?.let { Instant.ofEpochMilli(it).toString() }
            when (
                val r = repo.verify(
                    orderId = orderId,
                    paymentId = paymentId,
                    signature = signature,
                    memberId = selectedMemberId,
                    manualAddress = address.trim(),
                    earliest = earliest,
                    scheduledForIso = scheduledIso,
                )
            ) {
                is TeleconsultRepository.VerifyResult.Ok ->
                    _phase.value = TeleconsultPhase.Confirmed(r.bookingCode, formatSlot(r.scheduledFor))
                is TeleconsultRepository.VerifyResult.Err ->
                    _phase.value = TeleconsultPhase.Failed(r.message)
            }
        }
    }

    /** Payment sheet cancelled / errored (no capture) — return to the form. */
    fun onPaymentCancelled(message: String) {
        formError = message
        _phase.value = TeleconsultPhase.Form
    }

    fun retry() {
        formError = null
        _phase.value = TeleconsultPhase.Form
    }

    private fun formatSlot(iso: String?): String {
        if (iso.isNullOrBlank()) return ""
        return runCatching {
            Instant.parse(iso)
                .atZone(ZoneId.of("Asia/Kolkata"))
                .format(DateTimeFormatter.ofPattern("EEE, d MMM · h:mm a", Locale.ENGLISH))
        }.getOrDefault("")
    }
}
