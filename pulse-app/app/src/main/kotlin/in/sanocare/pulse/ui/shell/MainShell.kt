package `in`.sanocare.pulse.ui.shell

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import `in`.sanocare.pulse.data.auth.CachedCustomer
import `in`.sanocare.pulse.data.records.SelectedMember
import `in`.sanocare.pulse.theme.InkMute
import `in`.sanocare.pulse.theme.InkPrimary
import `in`.sanocare.pulse.theme.Paper
import `in`.sanocare.pulse.theme.SanocareBlue
import `in`.sanocare.pulse.theme.SanocareBlueSoft
import `in`.sanocare.pulse.ui.components.SanocareLockup
import `in`.sanocare.pulse.ui.family.FamilyScreen
import `in`.sanocare.pulse.ui.booking.TeleconsultBookingScreen
import `in`.sanocare.pulse.ui.home.HomeV2Screen
import `in`.sanocare.pulse.ui.profile.ProfileScreen
import `in`.sanocare.pulse.ui.records.BookingsTab
import `in`.sanocare.pulse.ui.records.RecordsScreen

// v2 — bottom-nav shell (retires the PB1 hamburger drawer). Tabs: Home · Bookings
// · Records · Profile. The drawer's items (Family / Help / Manage devices / Sign
// out) now live under Profile. The member chip + switcher sheet stay in the top
// bar, so switching re-scopes every tab at once.

private enum class Tab(val label: String, val icon: ImageVector) {
    HOME("Home", Icons.Outlined.Home),
    BOOKINGS("Bookings", Icons.Outlined.CalendarMonth),
    RECORDS("Records", Icons.Outlined.Description),
    PROFILE("Profile", Icons.Outlined.Person),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainShell(
    customer: CachedCustomer,
    onSignOut: () -> Unit,
) {
    var tab by remember { mutableStateOf(Tab.HOME) }
    var showMemberSheet by remember { mutableStateOf(false) }
    // Family is a sub-screen of Profile — it takes over the content area while the
    // bottom nav stays put, and Back returns to the Profile tab.
    var showFamily by remember { mutableStateOf(false) }
    // PB4a — native teleconsult booking, launched from the Home "Talk to a doctor"
    // card. Takes over the content area (bottom nav stays); Done → Bookings tab.
    var showTeleconsult by remember { mutableStateOf(false) }

    val firstName = customer.fullName?.trim()?.split(" ")?.firstOrNull()

    // Member switcher state (shared MemberScopeStore).
    val shellVm: ShellViewModel = hiltViewModel()
    val selected by shellVm.selected.collectAsState()
    val members by shellVm.members.collectAsState()
    val selfLabel = firstName ?: "You"
    val chipLabel = when (val s = selected) {
        SelectedMember.Self -> selfLabel
        is SelectedMember.Member -> s.name.trim().split(" ").firstOrNull() ?: s.name
    }

    Scaffold(
        containerColor = Paper,
        topBar = { TopBar(memberLabel = chipLabel, onMember = { showMemberSheet = true }) },
        bottomBar = {
            NavigationBar(containerColor = Paper) {
                Tab.entries.forEach { t ->
                    NavigationBarItem(
                        selected = tab == t && !showFamily && !showTeleconsult,
                        onClick = { showFamily = false; showTeleconsult = false; tab = t },
                        icon = { Icon(t.icon, contentDescription = t.label) },
                        label = { Text(t.label, fontSize = 11.sp) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = SanocareBlue,
                            selectedTextColor = SanocareBlue,
                            indicatorColor = SanocareBlueSoft,
                            unselectedIconColor = InkMute,
                            unselectedTextColor = InkMute,
                        ),
                    )
                }
            }
        },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            if (showTeleconsult) {
                TeleconsultBookingScreen(
                    prefillPhone = customer.phone,
                    onClose = { showTeleconsult = false },
                    onDone = { showTeleconsult = false; tab = Tab.BOOKINGS },
                )
            } else if (showFamily) {
                FamilyScreen(onBack = { showFamily = false })
            } else {
                // Cross-fade between tabs (v2 motion spec — bottom-nav cross-fade).
                Crossfade(targetState = tab, animationSpec = tween(200), label = "tab") { current ->
                    when (current) {
                        Tab.HOME -> HomeV2Screen(
                            firstName = firstName,
                            onBookTeleconsult = { showTeleconsult = true },
                        )
                        Tab.BOOKINGS -> BookingsTab(
                            onUnauthorized = onSignOut,
                            onStartBooking = { showFamily = false; tab = Tab.HOME },
                        )
                        Tab.RECORDS -> RecordsScreen(onUnauthorized = onSignOut)
                        Tab.PROFILE -> ProfileScreen(
                            fullName = customer.fullName,
                            phone = customer.phone,
                            onOpenFamily = { showFamily = true },
                            onSignOut = onSignOut,
                        )
                    }
                }
            }
        }
    }

    if (showMemberSheet) {
        ModalBottomSheet(
            onDismissRequest = { showMemberSheet = false },
            sheetState = rememberModalBottomSheetState(),
            containerColor = Paper,
        ) {
            Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) {
                Text("Viewing records for", color = InkMute, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                Spacer(Modifier.height(12.dp))
                MemberRow(
                    label = selfLabel,
                    selected = selected is SelectedMember.Self,
                    onClick = { shellVm.selectSelf(); showMemberSheet = false },
                )
                members.forEach { m ->
                    MemberRow(
                        label = m.name,
                        selected = (selected as? SelectedMember.Member)?.id == m.id,
                        onClick = { shellVm.selectMember(m); showMemberSheet = false },
                    )
                }
                Spacer(Modifier.height(16.dp))
            }
        }
    }
}

@Composable
private fun TopBar(memberLabel: String, onMember: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .height(56.dp)
            .background(Paper)
            .padding(horizontal = 16.dp),
    ) {
        SanocareLockup(markSize = 24.dp, wordmarkSp = 18)
        Spacer(Modifier.weight(1f))
        // Member chip + avatar.
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .clickable { onMember() }
                .background(SanocareBlueSoft, RoundedCornerShape(20.dp))
                .padding(start = 10.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
        ) {
            Text(text = memberLabel, color = SanocareBlue, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
            Spacer(Modifier.width(6.dp))
            Avatar(label = memberLabel)
        }
    }
}

@Composable
private fun Avatar(label: String) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier.size(28.dp).background(SanocareBlue, CircleShape),
    ) {
        Text(
            text = label.firstOrNull()?.uppercase() ?: "Y",
            color = Paper,
            fontWeight = FontWeight.Bold,
            fontSize = 13.sp,
        )
    }
}

@Composable
private fun MemberRow(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().clickable { onClick() }.padding(vertical = 10.dp),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier.size(32.dp).background(SanocareBlue, CircleShape),
        ) {
            Text(label.firstOrNull()?.uppercase() ?: "Y", color = Paper, fontWeight = FontWeight.Bold, fontSize = 14.sp)
        }
        Spacer(Modifier.width(12.dp))
        Text(text = label, color = InkPrimary, fontWeight = FontWeight.Medium, fontSize = 15.sp)
        Spacer(Modifier.weight(1f))
        if (selected) {
            Text(text = "✓", color = SanocareBlue, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        }
    }
}
