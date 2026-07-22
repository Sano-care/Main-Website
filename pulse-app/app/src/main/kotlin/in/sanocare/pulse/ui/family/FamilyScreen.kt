package `in`.sanocare.pulse.ui.family

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.sanocare.pulse.data.network.FamilyMemberDto
import `in`.sanocare.pulse.data.records.MemberScopeStore
import `in`.sanocare.pulse.data.records.PulseExtraRepository
import `in`.sanocare.pulse.data.records.RecordsRepository
import `in`.sanocare.pulse.data.records.WriteResult
import `in`.sanocare.pulse.theme.BorderHair
import `in`.sanocare.pulse.theme.InkMute
import `in`.sanocare.pulse.theme.InkPrimary
import `in`.sanocare.pulse.theme.InkSecondary
import `in`.sanocare.pulse.theme.Paper
import `in`.sanocare.pulse.theme.SanocareBlue
import `in`.sanocare.pulse.theme.SanocareBlueSoft
import `in`.sanocare.pulse.ui.records.Dropdown
import `in`.sanocare.pulse.ui.records.FormDialog
import `in`.sanocare.pulse.ui.records.FormField
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.Period
import javax.inject.Inject

@HiltViewModel
class FamilyViewModel @Inject constructor(
    private val records: RecordsRepository,
    private val extra: PulseExtraRepository,
    private val scope: MemberScopeStore,
) : ViewModel() {
    val members = scope.members

    init { refresh() }

    fun refresh() {
        viewModelScope.launch { scope.setMembers(records.familyMembers()) }
    }

    suspend fun add(name: String, relation: String, relationOther: String?, dob: String?): WriteResult =
        extra.addFamilyMember(name, relation, relationOther, dob, null).also {
            if (it is WriteResult.Ok) refresh()
        }
}

private val RELATIONS = listOf(
    "spouse" to "Spouse", "father" to "Father", "mother" to "Mother", "son" to "Son",
    "daughter" to "Daughter", "brother" to "Brother", "sister" to "Sister", "other" to "Other",
)

@Composable
fun FamilyScreen(onBack: () -> Unit) {
    val vm: FamilyViewModel = hiltViewModel()
    val members by vm.members.collectAsState()
    var showAdd by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 12.dp),
        ) {
            Icon(
                Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = InkSecondary,
                modifier = Modifier.size(40.dp).clickable { onBack() }.padding(8.dp),
            )
            Spacer(Modifier.width(4.dp))
            Text("Family members", color = InkPrimary, fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
            Spacer(Modifier.weight(1f))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.clickable { showAdd = true }.padding(horizontal = 8.dp, vertical = 4.dp),
            ) {
                Icon(Icons.Filled.Add, contentDescription = null, tint = SanocareBlue, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text("Add", color = SanocareBlue, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            }
        }

        if (members.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(28.dp), contentAlignment = Alignment.Center) {
                Text("No family members yet. Add a parent, partner, or child to book on their behalf.", color = InkMute, fontSize = 14.sp)
            }
        } else {
            LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
                items(members, key = { it.id }) { m -> MemberCard(m); Spacer(Modifier.height(10.dp)) }
            }
        }
    }

    if (showAdd) AddMemberDialog(vm) { showAdd = false }
}

@Composable
private fun MemberCard(m: FamilyMemberDto) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth()
            .background(Paper, RoundedCornerShape(16.dp))
            .padding(14.dp),
    ) {
        Box(Modifier.size(46.dp).background(SanocareBlueSoft, CircleShape), contentAlignment = Alignment.Center) {
            Text(m.name.firstOrNull()?.uppercase() ?: "•", color = SanocareBlue, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(m.name, color = InkPrimary, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Text(relationLabel(m) + ageSuffix(m.dob), color = InkMute, fontSize = 12.sp)
        }
    }
}

private fun relationLabel(m: FamilyMemberDto): String =
    if (m.relation == "other") (m.relationOther?.ifBlank { null } ?: "Family")
    else RELATIONS.firstOrNull { it.first == m.relation }?.second ?: (m.relation ?: "Family")

private fun ageSuffix(dob: String?): String {
    if (dob.isNullOrBlank()) return ""
    return runCatching { " · ${Period.between(LocalDate.parse(dob), LocalDate.now()).years}y" }.getOrDefault("")
}

@Composable
private fun AddMemberDialog(vm: FamilyViewModel, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var relation by remember { mutableStateOf(RELATIONS.first()) }
    var relationOther by remember { mutableStateOf("") }
    var dob by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    FormDialog(
        title = "Add a family member", saving = saving, error = error, saveLabel = "Add", onDismiss = onClose,
        onSave = {
            when {
                name.isBlank() -> error = "Please enter a name."
                relation.first == "other" && relationOther.isBlank() -> error = "Describe the relationship."
                else -> scope.launch {
                    saving = true; error = null
                    val r = vm.add(name.trim(), relation.first, relationOther.takeIf { relation.first == "other" }, dob.ifBlank { null })
                    when (r) { is WriteResult.Ok -> onClose(); is WriteResult.Err -> { saving = false; error = r.message } }
                }
            }
        },
    ) {
        FormField(name, { name = it }, "Full name")
        Dropdown("Relationship", RELATIONS, relation, { it.second }) { relation = it }
        if (relation.first == "other") FormField(relationOther, { relationOther = it }, "Relationship (e.g. Father-in-law)")
        FormField(dob, { dob = it }, "Date of birth (YYYY-MM-DD, optional)")
    }
}
