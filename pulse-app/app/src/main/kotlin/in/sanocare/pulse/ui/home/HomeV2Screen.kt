package `in`.sanocare.pulse.ui.home

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.outlined.HealthAndSafety
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.MedicalServices
import androidx.compose.material.icons.outlined.Medication
import androidx.compose.material.icons.outlined.Science
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import `in`.sanocare.pulse.data.network.BookingDto
import `in`.sanocare.pulse.theme.BorderHair
import `in`.sanocare.pulse.theme.InkMute
import `in`.sanocare.pulse.theme.InkPrimary
import `in`.sanocare.pulse.theme.InkSecondary
import `in`.sanocare.pulse.theme.Paper
import `in`.sanocare.pulse.theme.PaperMute
import `in`.sanocare.pulse.theme.SanocareBlue
import `in`.sanocare.pulse.ui.components.EmergencyRibbon
import `in`.sanocare.pulse.ui.components.PulseRefreshBox
import `in`.sanocare.pulse.ui.components.fadeRiseOnAppear
import `in`.sanocare.pulse.ui.components.pressScaleClickable
import `in`.sanocare.pulse.ui.records.serviceLabel
import `in`.sanocare.pulse.ui.records.formatDay
import java.util.Calendar

// v2 Home — warm engagement surface. Location + search, hero, priced service
// cards (interim gradient tiles — image slots swappable), "care at a glance"
// (next appointment / meds-due / BP sparkline from existing endpoints), a
// book-again rail, and the coral emergency ribbon (the one accent). Service
// taps are PB4 destinations (stubs for now).

private data class Service(val title: String, val price: String, val icon: ImageVector, val gradient: List<Color>)

// v2.1 — all four cards in the Sanocare blue family (calm + branded, not a
// fintech rainbow). Tonal steps around the #2B81FF primary give quiet depth;
// icons stay white monoline. Coral remains emergency-ribbon-only. Founder can
// fine-tune the exact shades after.
private val SERVICES = listOf(
    // PB4a — teleconsult price is server-driven (config GET), so the string is
    // empty here and filled at render time from HomeViewModel.teleconsultFrom
    // ("from ₹399"). No hardcoded price. The stale "from ₹199" is gone.
    Service("Talk to a doctor", "", Icons.Outlined.Videocam, listOf(Color(0xFF2B81FF), Color(0xFF1E63D6))),
    Service("Get tested at home", "from ₹499", Icons.Outlined.Science, listOf(Color(0xFF4E97FF), Color(0xFF2B81FF))),
    Service("Care at Home", "from ₹299", Icons.Outlined.HealthAndSafety, listOf(Color(0xFF1E63D6), Color(0xFF1647A1))),
    Service("Book a medic", "from ₹199", Icons.Outlined.MedicalServices, listOf(Color(0xFF3E8BFF), Color(0xFF2B6FE0))),
)

@Composable
fun HomeV2Screen(firstName: String?, onBookTeleconsult: () -> Unit) {
    val vm: HomeViewModel = hiltViewModel()
    val state by vm.state.collectAsState()
    val refreshing by vm.refreshing.collectAsState()
    val teleconsultFrom by vm.teleconsultFrom.collectAsState()

    PulseRefreshBox(refreshing = refreshing, onRefresh = vm::pullRefresh, modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
        ) {
            Spacer(Modifier.height(10.dp))
            LocationBar()
            Spacer(Modifier.height(12.dp))
            SearchBar()
            Spacer(Modifier.height(16.dp))
            Hero(firstName)

            Spacer(Modifier.height(18.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                ServiceCard(SERVICES[0], Modifier.weight(1f), priceOverride = teleconsultFrom, onClick = onBookTeleconsult)
                ServiceCard(SERVICES[1], Modifier.weight(1f))
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                ServiceCard(SERVICES[2], Modifier.weight(1f))
                ServiceCard(SERVICES[3], Modifier.weight(1f))
            }

            Spacer(Modifier.height(20.dp))
            Text("Your care at a glance", color = InkPrimary, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            Spacer(Modifier.height(10.dp))
            Column(Modifier.fadeRiseOnAppear()) {
                when (val s = state) {
                    HomeUiState.Loading, HomeUiState.Unauthorized -> GlanceSkeleton()
                    is HomeUiState.Ready -> GlanceSection(s.data)
                }
            }

            Spacer(Modifier.height(16.dp))
            EmergencyRibbon(text = "In an emergency, call 112")

            (state as? HomeUiState.Ready)?.data?.bookAgain?.takeIf { it.isNotEmpty() }?.let { rail ->
                Spacer(Modifier.height(20.dp))
                Text("Book again", color = InkPrimary, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                Spacer(Modifier.height(10.dp))
                LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(rail, key = { it.id }) { b -> BookAgainCard(b) }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun LocationBar() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.LocationOn, contentDescription = null, tint = SanocareBlue, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(6.dp))
        Column {
            Text("Delhi NCR", color = InkPrimary, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            Text("Home visits & teleconsults", color = InkMute, fontSize = 11.sp)
        }
    }
}

@Composable
private fun SearchBar() {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().height(46.dp)
            .background(PaperMute, RoundedCornerShape(14.dp))
            .border(1.dp, BorderHair, RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp),
    ) {
        Icon(Icons.Outlined.Search, contentDescription = null, tint = InkMute, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(10.dp))
        Text("Search doctors, tests, care…", color = InkMute, fontSize = 14.sp)
    }
}

@Composable
private fun Hero(firstName: String?) {
    val greeting = when (Calendar.getInstance().get(Calendar.HOUR_OF_DAY)) {
        in 5..11 -> "Good morning"; in 12..16 -> "Good afternoon"; else -> "Good evening"
    }
    Column(
        modifier = Modifier.fillMaxWidth()
            .background(Brush.linearGradient(listOf(Color(0xFF2B81FF), Color(0xFF1E63D6))), RoundedCornerShape(18.dp))
            .padding(18.dp),
    ) {
        Text(if (firstName.isNullOrBlank()) greeting else "$greeting, $firstName", color = Paper, fontWeight = FontWeight.Bold, fontSize = 20.sp)
        Spacer(Modifier.height(4.dp))
        Text("Care at home, the way it should be.", color = Paper.copy(alpha = 0.9f), fontSize = 13.sp)
    }
}

@Composable
private fun ServiceCard(
    s: Service,
    modifier: Modifier,
    priceOverride: String? = null,
    onClick: (() -> Unit)? = null,
) {
    // Interim branded gradient tile — image slot swappable for real photography later.
    val price = priceOverride ?: s.price
    Column(
        modifier = modifier.height(128.dp)
            .background(Brush.linearGradient(s.gradient), RoundedCornerShape(16.dp))
            .pressScaleClickable { onClick?.invoke() /* other cards: PB4b+ destinations */ }
            .padding(14.dp),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Icon(s.icon, contentDescription = null, tint = Paper, modifier = Modifier.size(26.dp))
        Column {
            Text(s.title, color = Paper, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 17.sp)
            if (price.isNotBlank()) {
                Spacer(Modifier.height(2.dp))
                Text(price, color = Paper.copy(alpha = 0.92f), fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun GlanceSection(d: HomeData) {
    // Next appointment.
    Card {
        if (d.nextBooking != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Next appointment", color = InkMute, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(3.dp))
                    Text(serviceLabel(d.nextBooking.serviceCategory), color = InkPrimary, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                    Text(formatDay(d.nextBooking.scheduledFor), color = InkSecondary, fontSize = 12.sp)
                }
                // Join is a PB4 (video) destination — shown as a hint until then.
                Text("Join opens near your time", color = InkMute, fontSize = 11.sp)
            }
        } else {
            Text("No upcoming appointment. Book care from the tiles above.", color = InkMute, fontSize = 13.sp)
        }
    }
    Spacer(Modifier.height(10.dp))
    // Meds due.
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Medication, contentDescription = null, tint = SanocareBlue, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("Medications today", color = InkMute, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    if (d.medsDue == 0) "No doses scheduled today." else "${d.medsTaken} of ${d.medsDue} taken",
                    color = InkPrimary, fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
                )
            }
        }
    }
    Spacer(Modifier.height(10.dp))
    // BP sparkline.
    Card {
        Column {
            Text("Blood pressure (30 days)", color = InkMute, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            if (d.bpSeries.size >= 2) {
                Sparkline(d.bpSeries, Modifier.fillMaxWidth().height(44.dp))
            } else {
                Text("Log a couple of readings to see your trend.", color = InkMute, fontSize = 13.sp)
            }
        }
    }
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth()
            .background(Paper, RoundedCornerShape(16.dp))
            .border(1.dp, BorderHair, RoundedCornerShape(16.dp))
            .padding(14.dp),
    ) { content() }
}

@Composable
private fun Sparkline(values: List<Double>, modifier: Modifier) {
    val color = SanocareBlue
    Canvas(modifier = modifier) {
        val min = values.min()
        val max = values.max()
        val range = (max - min).takeIf { it > 0 } ?: 1.0
        val stepX = if (values.size > 1) size.width / (values.size - 1) else size.width
        val pts = values.mapIndexed { i, v ->
            Offset(i * stepX, (size.height - ((v - min) / range * size.height)).toFloat())
        }
        for (i in 0 until pts.size - 1) {
            drawLine(color, pts[i], pts[i + 1], strokeWidth = 4f, cap = StrokeCap.Round)
        }
    }
}

@Composable
private fun BookAgainCard(b: BookingDto) {
    Column(
        modifier = Modifier.width(150.dp).height(96.dp)
            .background(PaperMute, RoundedCornerShape(14.dp))
            .border(1.dp, BorderHair, RoundedCornerShape(14.dp))
            .pressScaleClickable { /* PB4 re-book */ }
            .padding(12.dp),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(serviceLabel(b.serviceCategory), color = InkPrimary, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, lineHeight = 16.sp)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Book again", color = SanocareBlue, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
            Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = SanocareBlue, modifier = Modifier.size(16.dp))
        }
    }
}

@Composable
private fun GlanceSkeleton() {
    Column {
        repeat(3) {
            Box(Modifier.fillMaxWidth().height(64.dp).background(PaperMute, RoundedCornerShape(16.dp)))
            Spacer(Modifier.height(10.dp))
        }
    }
}
