package `in`.sanocare.pulse.ui.booking

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import `in`.sanocare.pulse.data.network.FamilyMemberDto
import `in`.sanocare.pulse.data.network.ProcedureDto
import `in`.sanocare.pulse.theme.BorderHair
import `in`.sanocare.pulse.theme.InkMute
import `in`.sanocare.pulse.theme.InkPrimary
import `in`.sanocare.pulse.theme.InkSecondary
import `in`.sanocare.pulse.theme.Paper
import `in`.sanocare.pulse.theme.PaperMute
import `in`.sanocare.pulse.theme.SanocareBlue
import `in`.sanocare.pulse.theme.SanocareBlueSoft
import `in`.sanocare.pulse.theme.SanocareMonoFamily
import `in`.sanocare.pulse.ui.components.PrimaryButton
import `in`.sanocare.pulse.ui.records.FormField
import com.razorpay.Checkout
import org.json.JSONObject

// PB5b — Medic-at-Home tier cart. Browse the frozen catalog by tier, adjust
// quantities, and the sticky total comes straight from /quote (server truth).
// Checkout collects patient + address + the Rx acknowledgement, then runs the
// same Razorpay → verify flow as the teleconsult booking.

private val TIERS = listOf(
    "base" to "Base care",
    "standard" to "Standard",
    "advanced" to "Advanced",
    "expert" to "Expert",
)

@Composable
fun MedicCartScreen(
    prefillPhone: String?,
    onClose: () -> Unit,
    onDone: () -> Unit,
) {
    val vm: MedicCartViewModel = hiltViewModel()
    val catalog by vm.catalog.collectAsState()
    val cart by vm.cart.collectAsState()
    val quote by vm.quote.collectAsState()
    val rx by vm.rx.collectAsState()
    val phase by vm.phase.collectAsState()
    val members by vm.members.collectAsState()
    val context = LocalContext.current
    val activity = context as? Activity

    var showCheckout by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        RazorpayBus.events.collect { r ->
            when (r) {
                is RazorpayResult.Success -> vm.onPaymentSuccess(r.orderId, r.paymentId, r.signature)
                is RazorpayResult.Failed -> vm.onPaymentCancelled(r.message)
            }
        }
    }
    LaunchedEffect(Unit) {
        vm.openCheckout.collect { req ->
            if (activity == null) {
                vm.onPaymentCancelled("Could not open the payment screen.")
            } else {
                runCatching { openMedicRazorpay(activity, req) }
                    .onFailure { vm.onPaymentCancelled(it.message ?: "Could not open payment.") }
            }
        }
    }

    Column(Modifier.fillMaxSize().background(Paper)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 12.dp),
        ) {
            Icon(
                Icons.Filled.Close, contentDescription = "Close", tint = InkSecondary,
                modifier = Modifier.size(40.dp)
                    .clickable { if (showCheckout) showCheckout = false else onClose() }
                    .padding(8.dp),
            )
            Spacer(Modifier.width(4.dp))
            Text(
                if (showCheckout) "Review & pay" else "Book a medic",
                color = InkPrimary, fontWeight = FontWeight.SemiBold, fontSize = 18.sp,
            )
        }

        when (val p = phase) {
            is MedicPhase.Confirmed -> ConfirmedView(p, onDone)
            else -> {
                val baseExtra = catalog?.baseExtraUnitPaise ?: 10_000
                if (showCheckout) {
                    CheckoutStep(
                        vm = vm,
                        members = members,
                        rxRequiredNames = rx.required.mapNotNull { code -> catalog?.procedures?.firstOrNull { it.code == code }?.name },
                        rxCaseByCaseNames = rx.caseByCase.mapNotNull { code -> catalog?.procedures?.firstOrNull { it.code == code }?.name },
                        consumablesNotes = cart.keys.mapNotNull { code -> catalog?.procedures?.firstOrNull { it.code == code } }
                            .filter { !it.consumablesNote.isNullOrBlank() && it.consumablesNote != "-" }
                            .map { (it.name ?: it.code) to it.consumablesNote!! },
                        prepayInr = ((quote?.prepayPaise ?: 0) / 100).toInt(),
                        atVisitInr = ((quote?.atVisitPaise ?: 0) / 100).toInt(),
                        working = phase is MedicPhase.Working,
                        failedMessage = (phase as? MedicPhase.Failed)?.message ?: vm.formError,
                        onPay = { vm.checkout(prefillPhone) },
                    )
                } else {
                    CartBrowse(
                        catalog = catalog,
                        cart = cart,
                        baseExtra = baseExtra,
                        prepayInr = quote?.let { (it.prepayPaise / 100).toInt() },
                        atVisitInr = ((quote?.atVisitPaise ?: 0) / 100).toInt(),
                        onInc = vm::increment,
                        onDec = vm::decrement,
                        onReview = { showCheckout = true },
                    )
                }
            }
        }
    }
}

@Composable
private fun CartBrowse(
    catalog: `in`.sanocare.pulse.data.network.MedicCatalogDto?,
    cart: Map<String, Int>,
    baseExtra: Long,
    prepayInr: Int?,
    atVisitInr: Int,
    onInc: (String) -> Unit,
    onDec: (String) -> Unit,
    onReview: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val procs = catalog?.procedures ?: emptyList()
    val itemCount = cart.values.sum()

    Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
            FormField(query, { query = it }, "Search procedures")
        }
        if (procs.isEmpty()) {
            Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = SanocareBlue)
            }
        } else {
            Box(Modifier.weight(1f)) {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                ) {
                    TIERS.forEach { (tierKey, tierLabel) ->
                        val rows = procs.filter {
                            it.tier == tierKey &&
                                (query.isBlank() || (it.name ?: "").contains(query, ignoreCase = true))
                        }
                        if (rows.isNotEmpty()) {
                            item(key = "h_$tierKey") { TierHeader(tierLabel) }
                            items(rows, key = { it.code }) { p ->
                                ProcedureRow(p, cart[p.code] ?: 0, baseExtra, onInc, onDec)
                            }
                        }
                    }
                }
            }
        }

        // Sticky pay bar.
        if (itemCount > 0) {
            Column(
                Modifier.fillMaxWidth()
                    .background(Paper)
                    .border(1.dp, BorderHair, RoundedCornerShape(0.dp))
                    .padding(16.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            if (prepayInr != null) "Pay now ₹$prepayInr" else "Calculating…",
                            color = InkPrimary, fontWeight = FontWeight.Bold, fontSize = 18.sp,
                            fontFamily = SanocareMonoFamily,
                        )
                        val note = buildString {
                            append("$itemCount added · ₹199 base visit")
                            if (atVisitInr > 0) append(" · +₹$atVisitInr est. at visit")
                        }
                        Text(note, color = InkMute, fontSize = 11.sp)
                    }
                    Spacer(Modifier.width(12.dp))
                    Box(Modifier.width(150.dp)) {
                        PrimaryButton(text = "Review & pay", onClick = onReview, enabled = prepayInr != null)
                    }
                }
            }
        }
    }
}

@Composable
private fun TierHeader(label: String) {
    Text(
        label,
        color = InkMute,
        fontWeight = FontWeight.Bold,
        fontSize = 12.sp,
        modifier = Modifier.padding(top = 14.dp, bottom = 6.dp),
    )
}

@Composable
private fun ProcedureRow(
    p: ProcedureDto,
    qty: Int,
    baseExtra: Long,
    onInc: (String) -> Unit,
    onDec: (String) -> Unit,
) {
    Column(
        Modifier.fillMaxWidth()
            .padding(vertical = 6.dp)
            .background(Paper, RoundedCornerShape(14.dp))
            .border(1.dp, if (qty > 0) SanocareBlue else BorderHair, RoundedCornerShape(14.dp))
            .padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(p.name ?: p.code, color = InkPrimary, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 18.sp)
                Spacer(Modifier.height(3.dp))
                Text(priceLabel(p, baseExtra), color = SanocareBlue, fontSize = 12.sp, fontFamily = SanocareMonoFamily)
                if (p.rxRequired == "yes") {
                    RxBadge("Prescription needed")
                } else if (p.rxRequired == "case_by_case") {
                    RxBadge("May need a prescription")
                }
                if (!p.consumablesNote.isNullOrBlank() && p.consumablesNote != "-") {
                    Spacer(Modifier.height(3.dp))
                    Text("Consumables: ${p.consumablesNote}", color = InkMute, fontSize = 11.sp)
                }
            }
            Spacer(Modifier.width(10.dp))
            Stepper(qty, { onInc(p.code) }, { onDec(p.code) })
        }
    }
}

@Composable
private fun RxBadge(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
        Box(
            Modifier.background(SanocareBlueSoft, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
        ) {
            Text(text, color = SanocareBlue, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun Stepper(qty: Int, onInc: () -> Unit, onDec: () -> Unit) {
    if (qty <= 0) {
        Box(
            Modifier.height(34.dp).width(64.dp)
                .background(SanocareBlue, RoundedCornerShape(10.dp))
                .clickable { onInc() },
            contentAlignment = Alignment.Center,
        ) {
            Text("Add", color = Paper, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
        }
    } else {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.height(34.dp)
                .background(PaperMute, RoundedCornerShape(10.dp))
                .border(1.dp, BorderHair, RoundedCornerShape(10.dp)),
        ) {
            StepBtn(Icons.Filled.Remove, onDec)
            Text("$qty", color = InkPrimary, fontWeight = FontWeight.Bold, fontSize = 14.sp, modifier = Modifier.width(28.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            StepBtn(Icons.Filled.Add, onInc)
        }
    }
}

@Composable
private fun StepBtn(icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    Box(
        Modifier.size(34.dp).clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = SanocareBlue, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun CheckoutStep(
    vm: MedicCartViewModel,
    members: List<FamilyMemberDto>,
    rxRequiredNames: List<String>,
    rxCaseByCaseNames: List<String>,
    consumablesNotes: List<Pair<String, String>>,
    prepayInr: Int,
    atVisitInr: Int,
    working: Boolean,
    failedMessage: String?,
    onPay: () -> Unit,
) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Text("Who is this for?", color = InkMute, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
        Spacer(Modifier.height(8.dp))
        SelectRow("Myself", vm.selectedMemberId == null) { vm.selectedMemberId = null }
        members.forEach { m -> SelectRow(m.name, vm.selectedMemberId == m.id) { vm.selectedMemberId = m.id } }

        Spacer(Modifier.height(18.dp))
        Text("Visit address", color = InkMute, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
        Spacer(Modifier.height(8.dp))
        FormField(vm.address, { vm.address = it }, "Address for the home visit", singleLine = false)

        if (rxRequiredNames.isNotEmpty()) {
            Spacer(Modifier.height(18.dp))
            Column(
                Modifier.fillMaxWidth()
                    .background(SanocareBlueSoft, RoundedCornerShape(14.dp))
                    .padding(14.dp),
            ) {
                Text("Prescription needed", color = InkPrimary, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                Spacer(Modifier.height(4.dp))
                Text(
                    "These need a valid prescription: ${rxRequiredNames.joinToString(", ")}.",
                    color = InkSecondary, fontSize = 12.sp,
                )
                Spacer(Modifier.height(10.dp))
                SelectRow(
                    "I'll share the prescription with the medic (they verify it at the visit)",
                    vm.rxAcknowledged,
                ) { vm.rxAcknowledged = !vm.rxAcknowledged }
            }
        }
        if (rxCaseByCaseNames.isNotEmpty()) {
            Spacer(Modifier.height(10.dp))
            Text(
                "Some items (${rxCaseByCaseNames.joinToString(", ")}) may need a prescription — the medic will advise.",
                color = InkMute, fontSize = 11.sp,
            )
        }

        if (consumablesNotes.isNotEmpty()) {
            Spacer(Modifier.height(18.dp))
            Text("Consumables", color = InkMute, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
            Spacer(Modifier.height(6.dp))
            Text(
                "Consumables are borne by the patient; if the medic carries them, they're charged extra — arranged on the coordination call.",
                color = InkSecondary, fontSize = 12.sp,
            )
        }

        Spacer(Modifier.height(18.dp))
        Column(
            Modifier.fillMaxWidth().background(PaperMute, RoundedCornerShape(14.dp)).padding(14.dp),
        ) {
            Row {
                Text("Pay now", color = InkSecondary, fontSize = 13.sp, modifier = Modifier.weight(1f))
                Text("₹$prepayInr", color = InkPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp, fontFamily = SanocareMonoFamily)
            }
            if (atVisitInr > 0) {
                Spacer(Modifier.height(4.dp))
                Row {
                    Text("Variable, settled at visit", color = InkMute, fontSize = 12.sp, modifier = Modifier.weight(1f))
                    Text("+₹$atVisitInr est.", color = InkMute, fontSize = 12.sp, fontFamily = SanocareMonoFamily)
                }
                Text(
                    "Extra drip hours, suture counts and 'from' items are settled with the medic at the visit.",
                    color = InkMute, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp),
                )
            }
        }

        if (!failedMessage.isNullOrBlank()) {
            Spacer(Modifier.height(14.dp))
            Text(failedMessage, color = SanocareBlue, fontSize = 13.sp)
        }

        Spacer(Modifier.height(20.dp))
        PrimaryButton(
            text = "Pay ₹$prepayInr & confirm",
            onClick = onPay,
            enabled = !working && !vm.rxBlocking && vm.address.trim().length >= 4,
            loading = working,
        )
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun ConfirmedView(p: MedicPhase.Confirmed, onDone: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(Modifier.size(64.dp).background(SanocareBlue, CircleShape), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Check, contentDescription = null, tint = Paper, modifier = Modifier.size(34.dp))
        }
        Spacer(Modifier.height(16.dp))
        Text("You're booked", color = InkPrimary, fontWeight = FontWeight.Bold, fontSize = 22.sp)
        if (!p.bookingCode.isNullOrBlank()) {
            Spacer(Modifier.height(6.dp))
            Text(p.bookingCode, color = InkMute, fontFamily = SanocareMonoFamily, fontSize = 13.sp)
        }
        Spacer(Modifier.height(12.dp))
        Text(
            "Paid ₹${p.prepayInr} now." +
                (if (p.atVisitInr > 0) " Variable extras (about ₹${p.atVisitInr}) are settled with the medic at the visit." else "") +
                " We'll call to confirm the time and details.",
            color = InkMute, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 8.dp),
        )
        Spacer(Modifier.height(28.dp))
        PrimaryButton(text = "Done", onClick = onDone)
    }
}

@Composable
private fun SelectRow(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().clickable { onClick() }.padding(vertical = 10.dp),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier.size(22.dp)
                .background(if (selected) SanocareBlue else Paper, CircleShape)
                .border(1.dp, if (selected) SanocareBlue else BorderHair, CircleShape),
        ) {
            if (selected) Icon(Icons.Filled.Check, contentDescription = null, tint = Paper, modifier = Modifier.size(14.dp))
        }
        Spacer(Modifier.width(12.dp))
        Text(label, color = InkPrimary, fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 18.sp)
    }
}

private fun priceLabel(p: ProcedureDto, baseExtra: Long): String {
    val delta = (p.deltaPaise / 100).toInt()
    val abs = (p.absolutePricePaise / 100).toInt()
    if (p.isBaseIncluded) return "Included · +₹${(baseExtra / 100).toInt()} each extra"
    return when (p.priceType) {
        "from" -> "+₹$delta onwards"
        "per_unit_addon" -> "+₹$delta +₹${((p.perUnitAddonPaise ?: 0) / 100).toInt()}/unit"
        "per_drip_hourly" -> "₹$abs per drip · +₹${((p.hourlyAddonPaise ?: 0) / 100).toInt()}/hr after 1st"
        else -> "+₹$delta"
    }
}

private fun openMedicRazorpay(activity: Activity, req: OpenCheckout) {
    val checkout = Checkout()
    checkout.setKeyID(req.order.keyId.orEmpty())
    val options = JSONObject().apply {
        put("name", "Sanocare")
        put("description", "Medic at Home visit")
        put("currency", req.order.currency)
        put("order_id", req.order.orderId)
        put("amount", req.order.amount)
        put("theme", JSONObject().put("color", "#2B81FF"))
        req.prefillContact?.let { put("prefill", JSONObject().put("contact", it)) }
    }
    checkout.open(activity, options)
}
