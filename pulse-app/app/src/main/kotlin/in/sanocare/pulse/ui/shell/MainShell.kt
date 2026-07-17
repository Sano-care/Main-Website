package `in`.sanocare.pulse.ui.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import `in`.sanocare.pulse.R
import `in`.sanocare.pulse.data.auth.CachedCustomer
import `in`.sanocare.pulse.data.records.SelectedMember
import `in`.sanocare.pulse.theme.BorderHair
import `in`.sanocare.pulse.theme.InkMute
import `in`.sanocare.pulse.theme.InkPrimary
import `in`.sanocare.pulse.theme.InkSecondary
import `in`.sanocare.pulse.theme.Paper
import `in`.sanocare.pulse.theme.SanocareBlue
import `in`.sanocare.pulse.theme.SanocareBlueSoft
import `in`.sanocare.pulse.ui.components.SanocareLockup
import `in`.sanocare.pulse.ui.home.HomeScreen
import `in`.sanocare.pulse.ui.records.RecordsScreen
import kotlinx.coroutines.launch

private enum class Dest(val titleRes: Int, val icon: ImageVector) {
    HOME(R.string.nav_home, Icons.Outlined.Home),
    RECORDS(R.string.nav_records, Icons.Outlined.Description),
    PROFILE(R.string.nav_profile, Icons.Outlined.Person),
    FAMILY(R.string.nav_family, Icons.Outlined.Group),
    SETTINGS(R.string.nav_settings, Icons.Outlined.Settings),
    HELP(R.string.nav_help, Icons.AutoMirrored.Outlined.HelpOutline),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainShell(
    customer: CachedCustomer,
    onSignOut: () -> Unit,
) {
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var dest by remember { mutableStateOf(Dest.HOME) }
    var showMemberSheet by remember { mutableStateOf(false) }
    val firstName = customer.fullName?.trim()?.split(" ")?.firstOrNull()

    // PB3 — member switcher state (shared MemberScopeStore).
    val shellVm: ShellViewModel = hiltViewModel()
    val selected by shellVm.selected.collectAsState()
    val members by shellVm.members.collectAsState()
    val selfLabel = firstName ?: stringResource(R.string.member_self)
    val chipLabel = when (val s = selected) {
        SelectedMember.Self -> selfLabel
        is SelectedMember.Member -> s.name.trim().split(" ").firstOrNull() ?: s.name
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet(drawerContainerColor = Paper) {
                DrawerContent(
                    current = dest,
                    onSelect = { d -> dest = d; scope.launch { drawerState.close() } },
                    onSignOut = { scope.launch { drawerState.close() }; onSignOut() },
                )
            }
        },
    ) {
        // statusBarsPadding → the top app bar sits below the status bar;
        // navigationBarsPadding → content clears the gesture/nav bar at the bottom.
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding(),
        ) {
            TopBar(
                memberLabel = chipLabel,
                onMenu = { scope.launch { drawerState.open() } },
                onMember = { showMemberSheet = true },
            )
            Box(modifier = Modifier.fillMaxSize()) {
                when (dest) {
                    Dest.HOME -> HomeScreen(firstName = firstName, onTile = { /* PB3–PB4 destinations */ })
                    Dest.RECORDS -> RecordsScreen(onUnauthorized = onSignOut)
                    else -> ComingSoon(title = stringResource(dest.titleRes))
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
                Text(
                    text = stringResource(R.string.member_switch_title),
                    color = InkMute,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 12.sp,
                )
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
private fun TopBar(memberLabel: String, onMenu: () -> Unit, onMember: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp)
            .background(Paper)
            .padding(horizontal = 8.dp),
    ) {
        Icon(
            imageVector = Icons.Filled.Menu,
            contentDescription = stringResource(R.string.shell_menu),
            tint = InkSecondary,
            modifier = Modifier
                .size(40.dp)
                .clickable { onMenu() }
                .padding(8.dp),
        )
        Spacer(Modifier.width(4.dp))
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
        Spacer(Modifier.width(4.dp))
    }
}

@Composable
private fun Avatar(label: String) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(28.dp)
            .background(SanocareBlue, CircleShape),
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
private fun DrawerContent(current: Dest, onSelect: (Dest) -> Unit, onSignOut: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxHeight()
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(16.dp),
    ) {
        Spacer(Modifier.height(12.dp))
        SanocareLockup(markSize = 28.dp, wordmarkSp = 20)
        Spacer(Modifier.height(24.dp))
        Dest.entries.forEach { d ->
            DrawerItem(
                icon = d.icon,
                label = stringResource(d.titleRes),
                selected = d == current,
                onClick = { onSelect(d) },
            )
        }
        Spacer(Modifier.weight(1f))
        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(BorderHair))
        Spacer(Modifier.height(8.dp))
        DrawerItem(
            icon = Icons.AutoMirrored.Outlined.Logout,
            label = stringResource(R.string.nav_sign_out),
            selected = false,
            onClick = onSignOut,
        )
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun DrawerItem(icon: ImageVector, label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .background(
                if (selected) SanocareBlueSoft else Paper,
                RoundedCornerShape(12.dp),
            )
            .padding(horizontal = 12.dp, vertical = 12.dp),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = if (selected) SanocareBlue else InkSecondary,
            modifier = Modifier.size(22.dp),
        )
        Spacer(Modifier.width(14.dp))
        Text(
            text = label,
            color = if (selected) SanocareBlue else InkPrimary,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            fontSize = 15.sp,
        )
    }
}

@Composable
private fun MemberRow(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(vertical = 10.dp),
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

@Composable
private fun ComingSoon(title: String) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text = title, color = InkPrimary, fontWeight = FontWeight.SemiBold, fontSize = 20.sp)
        Spacer(Modifier.height(8.dp))
        Text(text = stringResource(R.string.coming_soon), color = InkMute, fontSize = 14.sp)
    }
}
