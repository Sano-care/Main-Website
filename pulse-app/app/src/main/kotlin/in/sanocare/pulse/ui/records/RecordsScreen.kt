package `in`.sanocare.pulse.ui.records

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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Medication
import androidx.compose.material.icons.outlined.MonitorHeart
import androidx.compose.material.icons.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.Science
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import `in`.sanocare.pulse.R
import `in`.sanocare.pulse.data.network.BookingDto
import `in`.sanocare.pulse.data.network.InvoiceDto
import `in`.sanocare.pulse.data.network.PrescriptionDto
import `in`.sanocare.pulse.data.network.RecordsPayload
import `in`.sanocare.pulse.data.network.ReportDto
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
import kotlinx.coroutines.launch

// PB2 — Records surface. A nested nav (hub → list → detail) sharing one
// RecordsViewModel (the /api/pulse/records payload is loaded once). "From
// Sanocare" tier is live; the other tiers are disabled "coming soon" (PB3).

@Composable
fun RecordsScreen(onUnauthorized: () -> Unit) {
    val vm: RecordsViewModel = hiltViewModel()
    val state by vm.state.collectAsState()
    val nav = rememberNavController()

    LaunchedEffect(state) {
        if (state is RecordsUiState.Unauthorized) onUnauthorized()
    }

    NavHost(navController = nav, startDestination = "hub") {
        composable("hub") {
            RecordsHub(state = state, onRetry = vm::reload, onOpen = { nav.navigate(it) })
        }
        composable("bookings") {
            BookingsList(state, vm::reload, onBack = { nav.popBackStack() }) { nav.navigate("booking/$it") }
        }
        composable("booking/{id}") { entry ->
            BookingDetail(state, entry.arguments?.getString("id").orEmpty()) { nav.popBackStack() }
        }
        composable("prescriptions") {
            PrescriptionsList(state, vm::reload) { nav.popBackStack() }
        }
        composable("reports") {
            ReportsList(state, vm::reload) { nav.popBackStack() }
        }
        composable("invoices") {
            InvoicesList(state, vm::reload, onBack = { nav.popBackStack() }) { nav.navigate("invoice/$it") }
        }
        composable("invoice/{id}") { entry ->
            InvoiceDetail(state, vm, entry.arguments?.getString("id").orEmpty()) { nav.popBackStack() }
        }
        // PB3 — Tracked-together + Yours tiers.
        composable("vitals") { VitalsList(state, vm) { nav.popBackStack() } }
        composable("medications") { MedicationsList(state, vm) { nav.popBackStack() } }
        composable("conditions") { ConditionsList(state, vm) { nav.popBackStack() } }
        composable("allergies") { AllergiesList(state, vm) { nav.popBackStack() } }
        composable("documents") { DocumentsList(state, vm) { nav.popBackStack() } }
    }
}

// ── Hub ─────────────────────────────────────────────────────────────────────

@Composable
private fun RecordsHub(state: RecordsUiState, onRetry: () -> Unit, onOpen: (String) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp),
    ) {
        Spacer(Modifier.height(8.dp))
        Text(stringResource(R.string.records_title), color = InkPrimary, fontWeight = FontWeight.Bold, fontSize = 24.sp)

        when (state) {
            is RecordsUiState.Error -> {
                Spacer(Modifier.height(16.dp))
                ErrorState(stringResource(R.string.records_error), onRetry)
            }
            RecordsUiState.Loading, RecordsUiState.Unauthorized -> {
                Spacer(Modifier.height(16.dp))
                HubSkeleton()
            }
            is RecordsUiState.Ready -> {
                val p = state.payload
                Spacer(Modifier.height(16.dp))
                TierHeader(stringResource(R.string.records_tier_sanocare), stringResource(R.string.records_tier_sanocare_sub))
                Spacer(Modifier.height(10.dp))
                CategoryCard(Icons.Outlined.CalendarMonth, stringResource(R.string.records_bookings), p.bookings.size, true) { onOpen("bookings") }
                Spacer(Modifier.height(10.dp))
                CategoryCard(Icons.Outlined.Description, stringResource(R.string.records_prescriptions), p.prescriptions.size, true) { onOpen("prescriptions") }
                Spacer(Modifier.height(10.dp))
                CategoryCard(Icons.Outlined.Science, stringResource(R.string.records_reports), p.reports.size, true) { onOpen("reports") }
                Spacer(Modifier.height(10.dp))
                CategoryCard(Icons.Outlined.ReceiptLong, stringResource(R.string.records_invoices), p.invoices.size, true) { onOpen("invoices") }

                Spacer(Modifier.height(22.dp))
                TierHeader(stringResource(R.string.records_tier_tracked), null)
                Spacer(Modifier.height(10.dp))
                CategoryCard(Icons.Outlined.MonitorHeart, stringResource(R.string.records_vitals), p.vitals.size, true) { onOpen("vitals") }
                Spacer(Modifier.height(10.dp))
                CategoryCard(Icons.Outlined.Medication, stringResource(R.string.records_medications), p.medications.size, true) { onOpen("medications") }

                Spacer(Modifier.height(22.dp))
                TierHeader(stringResource(R.string.records_tier_yours), null)
                Spacer(Modifier.height(10.dp))
                CategoryCard(Icons.Outlined.MonitorHeart, stringResource(R.string.records_conditions), p.conditions.size, true) { onOpen("conditions") }
                Spacer(Modifier.height(10.dp))
                CategoryCard(Icons.Outlined.WarningAmber, stringResource(R.string.records_allergies), p.allergies.size, true) { onOpen("allergies") }
                Spacer(Modifier.height(10.dp))
                CategoryCard(Icons.Outlined.FolderOpen, stringResource(R.string.records_documents), p.documents.size, true) { onOpen("documents") }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

// ── Lists ───────────────────────────────────────────────────────────────────

@Composable
internal fun BookingsList(
    state: RecordsUiState,
    onRetry: () -> Unit,
    onBack: (() -> Unit)?,
    onStartBooking: (() -> Unit)? = null,
    onDetail: (String) -> Unit,
) {
    // v2.1 — "Book Now" is always reachable from the Bookings tab: a prominent
    // primary button on the empty state, and a persistent header button once the
    // list has items. Both route to the Home service tiles (onStartBooking). The
    // Records-hub nested bookings view passes onStartBooking = null (unchanged).
    val hasBookings = (state as? RecordsUiState.Ready)?.payload?.bookings?.isNotEmpty() == true
    RecordsScaffold(
        stringResource(R.string.records_bookings),
        onBack,
        state,
        onRetry,
        action = { if (onStartBooking != null && hasBookings) BookNowHeaderButton(onStartBooking) },
    ) { p ->
        if (p.bookings.isEmpty()) {
            if (onStartBooking != null) BookingsEmptyCta(onStartBooking)
            else EmptyState(stringResource(R.string.bookings_empty))
        } else LazyColumn(Modifier.fillMaxSize()) {
            items(p.bookings, key = { it.id }) { b ->
                val pill = bookingPill(b.status)
                ListRow(
                    title = serviceLabel(b.serviceCategory),
                    subtitle = formatDay(b.scheduledFor ?: b.createdAt),
                    trailing = { Pill(pill); Spacer(Modifier.width(6.dp)); Chevron() },
                    onClick = { onDetail(b.id) },
                )
            }
        }
    }
}

@Composable
private fun BookNowHeaderButton(onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .clickable { onClick() }
            .background(SanocareBlue, RoundedCornerShape(20.dp))
            .padding(horizontal = 14.dp, vertical = 7.dp),
    ) {
        Icon(Icons.Filled.Add, contentDescription = null, tint = Paper, modifier = Modifier.size(15.dp))
        Spacer(Modifier.width(5.dp))
        Text(stringResource(R.string.book_now), color = Paper, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
    }
}

@Composable
private fun BookingsEmptyCta(onBook: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            stringResource(R.string.bookings_empty),
            color = InkMute,
            fontSize = 14.sp,
        )
        Spacer(Modifier.height(18.dp))
        PrimaryButton(text = stringResource(R.string.book_now), onClick = onBook)
    }
}

@Composable
internal fun BookingDetail(state: RecordsUiState, id: String, onBack: () -> Unit) {
    RecordsScaffold(stringResource(R.string.records_bookings), onBack, state, {}) { p ->
        val b = p.bookings.firstOrNull { it.id == id } ?: return@RecordsScaffold EmptyState("Not found.")
        val amount = p.invoices.firstOrNull { it.bookingId == b.id }?.let { formatInr(it.amountPaise) } ?: "—"
        val pill = bookingPill(b.status)
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            DetailRow(stringResource(R.string.booking_detail_service), serviceLabel(b.serviceCategory))
            DetailRow(stringResource(R.string.booking_detail_for), if (b.memberId == null) stringResource(R.string.booking_for_self) else stringResource(R.string.booking_for_member))
            DetailRow(stringResource(R.string.booking_detail_when), formatDay(b.scheduledFor ?: b.createdAt))
            DetailRowContent(stringResource(R.string.booking_detail_status)) { Pill(pill) }
            DetailRow(stringResource(R.string.booking_detail_amount), amount, mono = true)
        }
    }
}

@Composable
private fun PrescriptionsList(state: RecordsUiState, onRetry: () -> Unit, onBack: () -> Unit) {
    val context = LocalContext.current
    RecordsScaffold(stringResource(R.string.records_prescriptions), onBack, state, onRetry) { p ->
        if (p.prescriptions.isEmpty()) EmptyState(stringResource(R.string.prescriptions_empty))
        else LazyColumn(Modifier.fillMaxSize()) {
            items(p.prescriptions, key = { it.id }) { rx ->
                val title = rx.doctorName?.let { stringResource(R.string.prescription_by, it) } ?: stringResource(R.string.prescription_by_unknown)
                val token = rx.patientViewToken
                ListRow(
                    title = title,
                    subtitle = formatDay(rx.sentAt),
                    trailing = { if (token != null) ActionText(stringResource(R.string.prescription_view)) },
                    onClick = { if (token != null) RecordOpen.openInCustomTab(context, RecordOpen.rxPdfUrl(token)) },
                )
            }
        }
    }
}

@Composable
private fun ReportsList(state: RecordsUiState, onRetry: () -> Unit, onBack: () -> Unit) {
    val context = LocalContext.current
    RecordsScaffold(stringResource(R.string.records_reports), onBack, state, onRetry) { p ->
        if (p.reports.isEmpty()) EmptyState(stringResource(R.string.reports_empty))
        else LazyColumn(Modifier.fillMaxSize()) {
            items(p.reports, key = { it.id }) { r ->
                val token = r.reportUnlockToken
                ListRow(
                    title = serviceLabel(r.serviceCategory).ifBlank { stringResource(R.string.records_reports) },
                    subtitle = formatDay(r.reportUploadedAt),
                    trailing = {
                        if (isRecent(r.reportUploadedAt)) { NewPill(); Spacer(Modifier.width(6.dp)) }
                        if (token != null) ActionText(stringResource(R.string.report_open))
                    },
                    onClick = { if (token != null) RecordOpen.openInCustomTab(context, RecordOpen.reportUrl(token)) },
                )
            }
        }
    }
}

@Composable
private fun InvoicesList(state: RecordsUiState, onRetry: () -> Unit, onBack: () -> Unit, onDetail: (String) -> Unit) {
    RecordsScaffold(stringResource(R.string.records_invoices), onBack, state, onRetry) { p ->
        if (p.invoices.isEmpty()) EmptyState(stringResource(R.string.invoices_empty))
        else LazyColumn(Modifier.fillMaxSize()) {
            items(p.invoices, key = { it.bookingId }) { inv ->
                val pill = invoicePill(inv.status)
                ListRow(
                    title = serviceLabel(inv.serviceCategory),
                    subtitle = formatDay(inv.capturedAt ?: inv.createdAt),
                    trailing = {
                        Text(formatInr(inv.amountPaise), color = InkPrimary, fontFamily = SanocareMonoFamily, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        Spacer(Modifier.width(8.dp)); Pill(pill); Spacer(Modifier.width(6.dp)); Chevron()
                    },
                    onClick = { onDetail(inv.bookingId) },
                )
            }
        }
    }
}

@Composable
private fun InvoiceDetail(state: RecordsUiState, vm: RecordsViewModel, id: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var downloading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    RecordsScaffold(stringResource(R.string.records_invoices), onBack, state, {}) { p ->
        val inv = p.invoices.firstOrNull { it.bookingId == id } ?: return@RecordsScaffold EmptyState("Not found.")
        val pill = invoicePill(inv.status)
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            Text(formatInr(inv.amountPaise), color = SanocareBlue, fontFamily = SanocareMonoFamily, fontWeight = FontWeight.Bold, fontSize = 30.sp)
            Spacer(Modifier.height(4.dp))
            Pill(pill)
            Spacer(Modifier.height(20.dp))
            DetailRow(stringResource(R.string.invoice_detail_receipt_no), inv.bookingCode ?: "—", mono = true)
            DetailRow(stringResource(R.string.invoice_detail_service), serviceLabel(inv.serviceCategory))
            DetailRow(stringResource(R.string.invoice_detail_date), formatDay(inv.capturedAt ?: inv.createdAt))
            if (inv.paymentRef != null) DetailRow(stringResource(R.string.invoice_detail_ref), inv.paymentRef, mono = true)
            Spacer(Modifier.height(24.dp))
            PrimaryButton(
                text = stringResource(R.string.invoice_download_receipt),
                loading = downloading,
                onClick = {
                    error = null
                    scope.launch {
                        downloading = true
                        val file = vm.downloadReceipt(inv.bookingId, inv.bookingCode)
                        downloading = false
                        if (file == null) error = context.getString(R.string.invoice_download_failed)
                        else if (!RecordOpen.openPdf(context, file)) error = context.getString(R.string.pdf_no_viewer)
                    }
                },
            )
            if (error != null) {
                Spacer(Modifier.height(10.dp))
                Text(error!!, color = androidx.compose.material3.MaterialTheme.colorScheme.error, fontSize = 13.sp)
            }
        }
    }
}

// ── Scaffolding + state renderers ────────────────────────────────────────────

@Composable
internal fun RecordsScaffold(
    title: String,
    onBack: (() -> Unit)?,
    state: RecordsUiState,
    onRetry: () -> Unit,
    action: @Composable () -> Unit = {},
    content: @Composable (RecordsPayload) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 12.dp),
        ) {
            if (onBack != null) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = InkSecondary,
                    modifier = Modifier.size(40.dp).clickable { onBack() }.padding(8.dp),
                )
                Spacer(Modifier.width(4.dp))
            } else {
                Spacer(Modifier.width(8.dp))
            }
            Text(title, color = InkPrimary, fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
            Spacer(Modifier.weight(1f))
            action()
        }
        when (state) {
            is RecordsUiState.Ready -> content(state.payload)
            is RecordsUiState.Error -> ErrorState(stringResource(R.string.records_error), onRetry)
            RecordsUiState.Loading, RecordsUiState.Unauthorized -> SkeletonList()
        }
    }
}

@Composable
private fun SkeletonList() {
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        repeat(6) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().height(64.dp).padding(vertical = 6.dp),
            ) {
                Box(Modifier.size(40.dp).background(PaperMute, CircleShape))
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Box(Modifier.fillMaxWidth(0.55f).height(13.dp).background(PaperMute, RoundedCornerShape(6.dp)))
                    Spacer(Modifier.height(8.dp))
                    Box(Modifier.fillMaxWidth(0.35f).height(11.dp).background(PaperMute, RoundedCornerShape(6.dp)))
                }
            }
        }
    }
}

@Composable
private fun HubSkeleton() {
    Column {
        repeat(4) {
            Box(Modifier.fillMaxWidth().height(64.dp).background(PaperMute, RoundedCornerShape(16.dp)))
            Spacer(Modifier.height(10.dp))
        }
    }
}

@Composable
internal fun EmptyState(text: String) {
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Text(text, color = InkMute, fontSize = 14.sp)
    }
}

@Composable
private fun ErrorState(text: String, onRetry: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text, color = InkSecondary, fontSize = 14.sp)
        Spacer(Modifier.height(14.dp))
        Box(
            Modifier.border(1.dp, BorderHair, RoundedCornerShape(12.dp)).clickable { onRetry() }.padding(horizontal = 18.dp, vertical = 10.dp),
        ) { Text(stringResource(R.string.records_retry), color = SanocareBlue, fontWeight = FontWeight.SemiBold, fontSize = 14.sp) }
    }
}

// ── Rows + cards + pills ─────────────────────────────────────────────────────

@Composable
internal fun ListRow(title: String, subtitle: String, trailing: @Composable () -> Unit = {}, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().clickable { onClick() }.padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, color = InkPrimary, fontWeight = FontWeight.Medium, fontSize = 15.sp, maxLines = 1)
            Spacer(Modifier.height(3.dp))
            Text(subtitle, color = InkMute, fontSize = 12.sp)
        }
        Row(verticalAlignment = Alignment.CenterVertically) { trailing() }
    }
}

@Composable
private fun CategoryCard(icon: ImageVector, label: String, count: Int, enabled: Boolean, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth()
            .border(1.dp, BorderHair, RoundedCornerShape(16.dp))
            .clickable(enabled = enabled) { onClick() }
            .padding(14.dp),
    ) {
        Box(Modifier.size(40.dp).background(SanocareBlueSoft, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = SanocareBlue, modifier = Modifier.size(22.dp))
        }
        Spacer(Modifier.width(14.dp))
        Text(label, color = InkPrimary, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, modifier = Modifier.weight(1f))
        Text(count.toString(), color = InkSecondary, fontFamily = SanocareMonoFamily, fontSize = 14.sp)
        Spacer(Modifier.width(8.dp))
        Chevron()
    }
}

@Composable
private fun ComingSoonCard(icon: ImageVector, label: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().border(1.dp, BorderHair, RoundedCornerShape(16.dp)).padding(14.dp),
    ) {
        Box(Modifier.size(40.dp).background(PaperMute, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = InkMute, modifier = Modifier.size(22.dp))
        }
        Spacer(Modifier.width(14.dp))
        Text(label, color = InkMute, fontWeight = FontWeight.Medium, fontSize = 15.sp, modifier = Modifier.weight(1f))
        Text(stringResource(R.string.coming_soon), color = InkMute, fontSize = 12.sp)
    }
}

@Composable
private fun TierHeader(title: String, subtitle: String?) {
    Column {
        Text(title.uppercase(), color = InkMute, fontWeight = FontWeight.SemiBold, fontSize = 11.sp)
        if (subtitle != null) {
            Spacer(Modifier.height(2.dp))
            Text(subtitle, color = InkMute, fontSize = 12.sp)
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String, mono: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Text(label, color = InkMute, fontSize = 13.sp, modifier = Modifier.width(110.dp))
        Text(
            value, color = InkPrimary, fontSize = 14.sp, fontWeight = FontWeight.Medium,
            fontFamily = if (mono) SanocareMonoFamily else null, modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun DetailRowContent(label: String, content: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = InkMute, fontSize = 13.sp, modifier = Modifier.width(110.dp))
        content()
    }
}

@Composable
internal fun Pill(pill: StatusPill) {
    Box(Modifier.background(pill.bg, RoundedCornerShape(8.dp)).padding(horizontal = 8.dp, vertical = 3.dp)) {
        Text(pill.label, color = pill.fg, fontWeight = FontWeight.SemiBold, fontSize = 11.sp)
    }
}

@Composable
private fun NewPill() {
    Box(Modifier.background(SanocareBlueSoft, RoundedCornerShape(8.dp)).padding(horizontal = 8.dp, vertical = 3.dp)) {
        Text(stringResource(R.string.report_new), color = SanocareBlue, fontWeight = FontWeight.SemiBold, fontSize = 11.sp)
    }
}

@Composable
internal fun ActionText(text: String) {
    Text(text, color = SanocareBlue, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
}

@Composable
internal fun Chevron() {
    Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = InkMute, modifier = Modifier.size(20.dp))
}
