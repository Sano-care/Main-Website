package `in`.sanocare.pulse.ui.booking

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.sanocare.pulse.data.booking.MedicRepository
import `in`.sanocare.pulse.data.network.CartItemDto
import `in`.sanocare.pulse.data.network.CreateOrderDto
import `in`.sanocare.pulse.data.network.MedicCatalogDto
import `in`.sanocare.pulse.data.network.QuoteDto
import `in`.sanocare.pulse.data.network.RxDto
import `in`.sanocare.pulse.data.records.MemberScopeStore
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

// PB5b — medic cart. Browse the catalog, adjust quantities, and the sticky total
// is driven by /api/pulse/medic/quote (server truth — the app never computes a
// price). Checkout: create-order → Razorpay sheet → verify. Same payment bridge
// (RazorpayBus + OpenCheckout) as the teleconsult flow.

sealed interface MedicPhase {
    data object Browsing : MedicPhase
    data object Working : MedicPhase
    data class Confirmed(val bookingCode: String?, val prepayInr: Int, val atVisitInr: Int) : MedicPhase
    data class Failed(val message: String) : MedicPhase
}

@HiltViewModel
class MedicCartViewModel @Inject constructor(
    private val repo: MedicRepository,
    scope: MemberScopeStore,
) : ViewModel() {

    val members = scope.members

    private val _catalog = MutableStateFlow<MedicCatalogDto?>(null)
    val catalog: StateFlow<MedicCatalogDto?> = _catalog.asStateFlow()

    /** code → qty. Empty entries are removed. */
    private val _cart = MutableStateFlow<Map<String, Int>>(emptyMap())
    val cart: StateFlow<Map<String, Int>> = _cart.asStateFlow()

    private val _quote = MutableStateFlow<QuoteDto?>(null)
    val quote: StateFlow<QuoteDto?> = _quote.asStateFlow()

    private val _rx = MutableStateFlow(RxDto())
    val rx: StateFlow<RxDto> = _rx.asStateFlow()

    private val _phase = MutableStateFlow<MedicPhase>(MedicPhase.Browsing)
    val phase: StateFlow<MedicPhase> = _phase.asStateFlow()

    private val _openCheckout = MutableSharedFlow<OpenCheckout>(extraBufferCapacity = 1)
    val openCheckout = _openCheckout.asSharedFlow()

    // ── checkout form state ────────────────────────────────────────────────
    var selectedMemberId by mutableStateOf<String?>(null)
    var address by mutableStateOf("")
    /** Rx acknowledgement for rx_required='yes' items ("medic will verify"). */
    var rxAcknowledged by mutableStateOf(false)
    var formError by mutableStateOf<String?>(null)
        private set

    private var quoteJob: Job? = null

    init {
        viewModelScope.launch { _catalog.value = repo.catalog() }
    }

    fun setQty(code: String, qty: Int) {
        val next = _cart.value.toMutableMap()
        if (qty <= 0) next.remove(code) else next[code] = qty.coerceAtMost(99)
        _cart.value = next
        refreshQuote()
    }

    fun increment(code: String) = setQty(code, (_cart.value[code] ?: 0) + 1)
    fun decrement(code: String) = setQty(code, (_cart.value[code] ?: 0) - 1)

    private fun toItems(): List<CartItemDto> =
        _cart.value.filter { it.value > 0 }.map { CartItemDto(code = it.key, qty = it.value) }

    private fun refreshQuote() {
        quoteJob?.cancel()
        val items = toItems()
        if (items.isEmpty()) {
            _quote.value = null
            _rx.value = RxDto()
            rxAcknowledged = false
            return
        }
        quoteJob = viewModelScope.launch {
            delay(350) // debounce rapid stepper taps → one server call
            val res = repo.quote(items)
            if (res != null) {
                _quote.value = res.quote
                _rx.value = res.rx
                if (res.rx.required.isEmpty()) rxAcknowledged = false
            }
        }
    }

    /** True when an rx_required='yes' item is in the cart but not acknowledged. */
    val rxBlocking: Boolean get() = _rx.value.required.isNotEmpty() && !rxAcknowledged

    fun checkout(prefillContact: String?) {
        formError = null
        val items = toItems()
        if (items.isEmpty()) { formError = "Add at least one procedure."; return }
        if (address.trim().length < 4) { formError = "Please enter the visit address."; return }
        if (_rx.value.required.isNotEmpty() && !rxAcknowledged) {
            formError = "Please confirm the prescription step before paying."
            return
        }
        _phase.value = MedicPhase.Working
        viewModelScope.launch {
            when (val r = repo.createOrder(items)) {
                is MedicRepository.OrderResult.Ok ->
                    _openCheckout.emit(
                        OpenCheckout(
                            CreateOrderDto(
                                orderId = r.order.orderId,
                                amount = r.order.amount,
                                currency = r.order.currency,
                                keyId = r.order.keyId,
                            ),
                            prefillContact,
                        ),
                    )
                is MedicRepository.OrderResult.Err ->
                    _phase.value = MedicPhase.Failed(r.message)
            }
        }
    }

    fun onPaymentSuccess(orderId: String, paymentId: String, signature: String) {
        _phase.value = MedicPhase.Working
        viewModelScope.launch {
            when (
                val r = repo.verify(
                    orderId = orderId,
                    paymentId = paymentId,
                    signature = signature,
                    items = toItems(),
                    memberId = selectedMemberId,
                    manualAddress = address.trim(),
                )
            ) {
                is MedicRepository.VerifyResult.Ok ->
                    _phase.value = MedicPhase.Confirmed(
                        bookingCode = r.bookingCode,
                        prepayInr = (r.prepayPaise / 100).toInt(),
                        atVisitInr = (r.atVisitPaise / 100).toInt(),
                    )
                is MedicRepository.VerifyResult.Err ->
                    _phase.value = MedicPhase.Failed(r.message)
            }
        }
    }

    fun onPaymentCancelled(message: String) {
        formError = message
        _phase.value = MedicPhase.Browsing
    }

    fun retry() {
        formError = null
        _phase.value = MedicPhase.Browsing
    }
}
