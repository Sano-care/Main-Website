package `in`.sanocare.pulse.ui.booking

import android.app.Activity
import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Context
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.runtime.LaunchedEffect
import `in`.sanocare.pulse.data.network.FamilyMemberDto
import `in`.sanocare.pulse.data.network.TeleconsultConfigDto
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
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import com.razorpay.Checkout

// PB4a — native teleconsultation booking + payment. Book (patient/member +
// address + timing) → server-priced Razorpay order → Razorpay Android sheet →
// bearer verify (server writes booking + consult session) → in-app confirmation.
// The video JOIN is unchanged: the /c/<token> link arrives on WhatsApp ~10 min
// before the slot and opens the existing Daily page in Chrome.

@Composable
fun TeleconsultBookingScreen(
    prefillPhone: String?,
    onClose: () -> Unit,
    onDone: () -> Unit,
) {
    val vm: TeleconsultViewModel = hiltViewModel()
    val config by vm.config.collectAsState()
    val phase by vm.phase.collectAsState()
    val members by vm.members.collectAsState()
    val context = LocalContext.current
    val activity = context as? Activity

    // Razorpay Activity callbacks → bus → VM.
    LaunchedEffect(Unit) {
        RazorpayBus.events.collect { r ->
            when (r) {
                is RazorpayResult.Success -> vm.onPaymentSuccess(r.orderId, r.paymentId, r.signature)
                is RazorpayResult.Failed -> vm.onPaymentCancelled(r.message)
            }
        }
    }
    // Open the Razorpay sheet when the VM has an order.
    LaunchedEffect(Unit) {
        vm.openCheckout.collect { req ->
            if (activity == null) {
                vm.onPaymentCancelled("Could not open the payment screen.")
            } else {
                runCatching { openRazorpay(activity, req) }
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
                modifier = Modifier.size(40.dp).clickable { onClose() }.padding(8.dp),
            )
            Spacer(Modifier.width(4.dp))
            Text("Talk to a doctor", color = InkPrimary, fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
        }

        when (val p = phase) {
            is TeleconsultPhase.Confirmed -> ConfirmedView(p, onDone)
            else -> BookingForm(
                vm = vm,
                config = config,
                members = members,
                working = phase is TeleconsultPhase.Working,
                failedMessage = (phase as? TeleconsultPhase.Failed)?.message ?: vm.formError,
                prefillPhone = prefillPhone,
            )
        }
    }
}

@Composable
private fun BookingForm(
    vm: TeleconsultViewModel,
    config: TeleconsultConfigDto?,
    members: List<FamilyMemberDto>,
    working: Boolean,
    failedMessage: String?,
    prefillPhone: String?,
) {
    val context = LocalContext.current
    val advanceInr = config?.let { (it.advancePaise / 100).toInt() }
    val fullInr = config?.displayInr

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
    ) {
        // Price summary.
        Column(
            Modifier.fillMaxWidth()
                .background(SanocareBlueSoft, RoundedCornerShape(16.dp))
                .padding(16.dp),
        ) {
            Text("15-min video consult with an MBBS doctor", color = InkPrimary, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Spacer(Modifier.height(6.dp))
            if (advanceInr != null && fullInr != null) {
                Text(
                    "₹$fullInr consult",
                    color = InkSecondary,
                    fontFamily = SanocareMonoFamily,
                    fontSize = 13.sp,
                )
                Text(
                    "Pay ₹$advanceInr now · ₹${fullInr - advanceInr} after the consult",
                    color = InkMute,
                    fontSize = 12.sp,
                )
            } else {
                Text("Loading price…", color = InkMute, fontSize = 12.sp)
            }
        }

        Spacer(Modifier.height(20.dp))
        SectionLabel("Who is this for?")
        Spacer(Modifier.height(8.dp))
        SelectRow("Myself", vm.selectedMemberId == null) { vm.selectedMemberId = null }
        members.forEach { m ->
            SelectRow(m.name, vm.selectedMemberId == m.id) { vm.selectedMemberId = m.id }
        }

        Spacer(Modifier.height(20.dp))
        SectionLabel("Address")
        Spacer(Modifier.height(8.dp))
        FormField(vm.address, { vm.address = it }, "Address (for our medical records)", singleLine = false)

        Spacer(Modifier.height(20.dp))
        SectionLabel("When?")
        Spacer(Modifier.height(8.dp))
        SelectRow("Earliest (~15 min)", vm.earliest) { vm.earliest = true }
        SelectRow("Schedule for later", !vm.earliest) { vm.earliest = false }
        if (!vm.earliest) {
            Spacer(Modifier.height(8.dp))
            val label = vm.laterMillis?.let { slotFormat.format(java.util.Date(it)) } ?: "Pick date & time (9 AM–9 PM)"
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
                    .background(PaperMute, RoundedCornerShape(12.dp))
                    .border(1.dp, BorderHair, RoundedCornerShape(12.dp))
                    .clickable { pickDateTime(context, vm.laterMillis) { vm.laterMillis = it } }
                    .padding(14.dp),
            ) {
                Text(label, color = if (vm.laterMillis != null) InkPrimary else InkMute, fontSize = 14.sp)
            }
            Text(
                "We hold consults 9 AM–9 PM (IST); times outside that shift to the next 9 AM.",
                color = InkMute, fontSize = 11.sp, modifier = Modifier.padding(top = 6.dp),
            )
        }

        if (!failedMessage.isNullOrBlank()) {
            Spacer(Modifier.height(14.dp))
            Text(failedMessage, color = SanocareBlue, fontSize = 13.sp)
        }

        Spacer(Modifier.height(24.dp))
        PrimaryButton(
            text = if (advanceInr != null) "Pay ₹$advanceInr & confirm" else "Confirm booking",
            onClick = { vm.submit(prefillPhone) },
            enabled = !working && advanceInr != null,
            loading = working,
        )
        Spacer(Modifier.height(10.dp))
        Text(
            "You'll complete a quick medical consent when you join the video call.",
            color = InkMute, fontSize = 11.sp,
        )
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun ConfirmedView(p: TeleconsultPhase.Confirmed, onDone: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier.size(64.dp).background(SanocareBlue, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Filled.Check, contentDescription = null, tint = Paper, modifier = Modifier.size(34.dp))
        }
        Spacer(Modifier.height(16.dp))
        Text("You're booked", color = InkPrimary, fontWeight = FontWeight.Bold, fontSize = 22.sp)
        if (p.slotLabel.isNotBlank()) {
            Spacer(Modifier.height(6.dp))
            Text(p.slotLabel, color = InkSecondary, fontSize = 15.sp)
        }
        if (!p.bookingCode.isNullOrBlank()) {
            Spacer(Modifier.height(4.dp))
            Text(p.bookingCode, color = InkMute, fontFamily = SanocareMonoFamily, fontSize = 13.sp)
        }
        Spacer(Modifier.height(16.dp))
        Text(
            "Your video link arrives on WhatsApp about 10 minutes before your consult. Tap it to join in your browser — no app needed.",
            color = InkMute, fontSize = 13.sp,
            modifier = Modifier.padding(horizontal = 8.dp),
        )
        Spacer(Modifier.height(28.dp))
        PrimaryButton(text = "Done", onClick = onDone)
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text, color = InkMute, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
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
        Text(label, color = InkPrimary, fontWeight = FontWeight.Medium, fontSize = 15.sp)
    }
}

private val slotFormat = SimpleDateFormat("EEE, d MMM · h:mm a", Locale.ENGLISH)

private fun pickDateTime(context: Context, initialMillis: Long?, onPicked: (Long) -> Unit) {
    val cal = Calendar.getInstance()
    initialMillis?.let { cal.timeInMillis = it }
    DatePickerDialog(
        context,
        { _, y, mo, d ->
            TimePickerDialog(
                context,
                { _, h, min ->
                    val out = Calendar.getInstance()
                    out.set(y, mo, d, h, min, 0)
                    out.set(Calendar.MILLISECOND, 0)
                    onPicked(out.timeInMillis)
                },
                cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE), false,
            ).show()
        },
        cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH),
    ).apply { datePicker.minDate = System.currentTimeMillis() }.show()
}

private fun openRazorpay(activity: Activity, req: OpenCheckout) {
    val checkout = Checkout()
    checkout.setKeyID(req.order.keyId.orEmpty()) // non-blank guaranteed by createOrder()
    val options = JSONObject().apply {
        put("name", "Sanocare")
        put("description", "Teleconsultation advance")
        put("currency", req.order.currency)
        put("order_id", req.order.orderId)
        put("amount", req.order.amount)
        put("theme", JSONObject().put("color", "#2B81FF"))
        req.prefillContact?.let { put("prefill", JSONObject().put("contact", it)) }
    }
    checkout.open(activity, options)
}
