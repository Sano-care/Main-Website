package `in`.sanocare.pulse.ui.profile

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material.icons.outlined.Notes
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.sanocare.pulse.data.records.PulseExtraRepository
import `in`.sanocare.pulse.data.records.WriteResult
import `in`.sanocare.pulse.theme.BorderHair
import `in`.sanocare.pulse.theme.InkMute
import `in`.sanocare.pulse.theme.InkPrimary
import `in`.sanocare.pulse.theme.InkSecondary
import `in`.sanocare.pulse.theme.Paper
import `in`.sanocare.pulse.theme.SanocareBlue
import `in`.sanocare.pulse.theme.SanocareBlueSoft
import `in`.sanocare.pulse.theme.SanocareMonoFamily
import `in`.sanocare.pulse.ui.records.FormDialog
import `in`.sanocare.pulse.ui.records.FormField
import `in`.sanocare.pulse.ui.records.RecordOpen
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

// v2 — Profile screen. Fills the PB1 "coming soon" stub. Shows identity from the
// locally cached login session (name + phone — the /api/pulse/account GET is gated
// by the web OTP cookie, not the bearer, so it is not reachable from the app) plus
// write-only editors for email & health notes (existing bearer POSTs — no read
// endpoint exposes their current values yet, flagged), and the menu that absorbs
// the retired drawer: Family members, Manage devices, Help, Sign out.

@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val extra: PulseExtraRepository,
) : ViewModel() {
    suspend fun setEmail(email: String): WriteResult = extra.setEmail(email)
    suspend fun setHealthNotes(notes: String?): WriteResult = extra.setHealthNotes(notes)
}

@Composable
fun ProfileScreen(
    fullName: String?,
    phone: String?,
    onOpenFamily: () -> Unit,
    onSignOut: () -> Unit,
) {
    val vm: ProfileViewModel = hiltViewModel()
    val context = LocalContext.current
    var editEmail by remember { mutableStateOf(false) }
    var editNotes by remember { mutableStateOf(false) }

    val displayName = fullName?.ifBlank { null } ?: "Your profile"

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
    ) {
        Spacer(Modifier.height(8.dp))
        // Identity header.
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier.size(64.dp).background(SanocareBlue, CircleShape),
            ) {
                Text(displayName.firstOrNull()?.uppercase() ?: "Y", color = Paper, fontWeight = FontWeight.Bold, fontSize = 26.sp)
            }
            Spacer(Modifier.width(16.dp))
            Column {
                Text(displayName, color = InkPrimary, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                if (phone != null) Text(phone!!, color = InkSecondary, fontFamily = SanocareMonoFamily, fontSize = 13.sp)
            }
        }

        Spacer(Modifier.height(22.dp))
        MenuRow(Icons.Outlined.MailOutline, "Email", "Add or update your email") { editEmail = true }
        MenuRow(Icons.Outlined.Notes, "Health notes", "Anything your care team should know") { editNotes = true }

        Spacer(Modifier.height(8.dp))
        Box(Modifier.fillMaxWidth().height(1.dp).background(BorderHair))
        Spacer(Modifier.height(8.dp))

        MenuRow(Icons.Outlined.Group, "Family members", "Manage who you book for", onOpenFamily)
        MenuRow(Icons.Outlined.Devices, "Manage devices", "Coming soon") { /* no device-list endpoint yet */ }
        MenuRow(Icons.AutoMirrored.Outlined.HelpOutline, "Help & support", "Reach the Sanocare team") {
            RecordOpen.openInCustomTab(context, "https://sanocare.in/pulse/help")
        }
        MenuRow(Icons.Outlined.Logout, "Sign out", null, onSignOut)
        Spacer(Modifier.height(24.dp))
    }

    if (editEmail) EmailDialog(vm) { editEmail = false }
    if (editNotes) HealthNotesDialog(vm) { editNotes = false }
}

@Composable
private fun MenuRow(icon: ImageVector, title: String, subtitle: String?, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().clickable { onClick() }.padding(vertical = 12.dp),
    ) {
        Box(Modifier.size(38.dp).background(SanocareBlueSoft, RoundedCornerShape(11.dp)), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = SanocareBlue, modifier = Modifier.size(20.dp))
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = InkPrimary, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            if (subtitle != null) Text(subtitle, color = InkMute, fontSize = 12.sp)
        }
        Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = InkMute, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun EmailDialog(vm: ProfileViewModel, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var email by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    FormDialog(
        title = "Your email", saving = saving, error = error, saveLabel = "Save", onDismiss = onClose,
        onSave = {
            when {
                !email.trim().contains("@") -> error = "Enter a valid email address."
                else -> scope.launch {
                    saving = true; error = null
                    when (val r = vm.setEmail(email)) { is WriteResult.Ok -> onClose(); is WriteResult.Err -> { saving = false; error = r.message } }
                }
            }
        },
    ) {
        FormField(email, { email = it }, "Email address")
        Text("We use it only for receipts and care updates.", color = InkMute, fontSize = 12.sp)
    }
}

@Composable
private fun HealthNotesDialog(vm: ProfileViewModel, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var notes by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    FormDialog(
        title = "Health notes", saving = saving, error = error, saveLabel = "Save", onDismiss = onClose,
        onSave = {
            scope.launch {
                saving = true; error = null
                when (val r = vm.setHealthNotes(notes)) { is WriteResult.Ok -> onClose(); is WriteResult.Err -> { saving = false; error = r.message } }
            }
        },
    ) {
        FormField(notes, { notes = it }, "Anything your care team should know", singleLine = false)
    }
}
