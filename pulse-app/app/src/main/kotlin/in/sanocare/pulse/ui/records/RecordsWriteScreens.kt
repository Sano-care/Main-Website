package `in`.sanocare.pulse.ui.records

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import `in`.sanocare.pulse.data.network.RecordsPayload
import `in`.sanocare.pulse.data.records.WriteResult
import `in`.sanocare.pulse.theme.InkMute
import `in`.sanocare.pulse.theme.InkPrimary
import `in`.sanocare.pulse.theme.InkSecondary
import `in`.sanocare.pulse.theme.PaperMute
import `in`.sanocare.pulse.theme.SanocareBlue
import `in`.sanocare.pulse.theme.SanocareMonoFamily
import kotlinx.coroutines.launch

// PB3 — the hybrid ("Tracked together") + patient ("Yours") tiers: list + add +
// delete/open. Vitals + Medications are account-level (no member_id) → when a
// family member is selected the server omits them and we show an account-level
// note. Conditions/Allergies/Documents are member-scoped (server IDOR-guards).

private fun omitted(p: RecordsPayload, key: String) = p.accountLevelOmitted.contains(key)

@Composable
private fun AddAction(label: String, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.clickable { onClick() }.padding(horizontal = 8.dp, vertical = 4.dp),
    ) {
        Icon(Icons.Filled.Add, contentDescription = null, tint = SanocareBlue, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(4.dp))
        Text(label, color = SanocareBlue, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
    }
}

@Composable
private fun AccountLevelNote() {
    Box(Modifier.fillMaxSize().padding(28.dp), contentAlignment = Alignment.Center) {
        Text(
            "These are tracked for your whole account. Switch back to Yourself (top bar) to view or add them.",
            color = InkMute, fontSize = 14.sp,
        )
    }
}

@Composable
private fun DeleteIcon(onClick: () -> Unit) {
    Icon(
        Icons.Outlined.Delete, contentDescription = "Remove", tint = InkMute,
        modifier = Modifier.size(34.dp).clickable { onClick() }.padding(7.dp),
    )
}

// ── Vitals ───────────────────────────────────────────────────────────────────

@Composable
fun VitalsList(state: RecordsUiState, vm: RecordsViewModel, onBack: () -> Unit) {
    var showAdd by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    RecordsScaffold(
        title = "Vitals", onBack = onBack, state = state, onRetry = { vm.reload() },
        action = {
            val p = (state as? RecordsUiState.Ready)?.payload
            if (p != null && !omitted(p, "vitals")) AddAction("Log") { showAdd = true }
        },
    ) { p ->
        when {
            omitted(p, "vitals") -> AccountLevelNote()
            p.vitals.isEmpty() -> EmptyState("No readings yet — log your first to start tracking.")
            else -> LazyColumn(Modifier.fillMaxSize()) {
                items(p.vitals, key = { it.id }) { v ->
                    ListRow(
                        title = "${vitalLabel(v.kind)}  ${vitalValueText(v.kind, v.valueNumeric, v.valueSecondary)} ${vitalUnit(v.kind)}".trim(),
                        subtitle = formatDay(v.takenAt),
                        trailing = { if (v.source == "manual") DeleteIcon { confirmDelete = v.id } },
                        onClick = {},
                    )
                }
            }
        }
    }

    if (showAdd) AddVitalDialog(vm) { showAdd = false }
    confirmDelete?.let { id ->
        ConfirmDeleteDialog("This reading will be removed.", onConfirm = {
            confirmDelete = null; scope.launch { vm.deleteVital(id) }
        }, onDismiss = { confirmDelete = null })
    }
}

@Composable
private fun AddVitalDialog(vm: RecordsViewModel, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var kind by remember { mutableStateOf(LOGGABLE_VITALS.first()) }
    var value by remember { mutableStateOf("") }
    var secondary by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    FormDialog(
        title = "Log a reading", saving = saving, error = error, saveLabel = "Save", onDismiss = onClose,
        onSave = {
            val primary = value.trim().toDoubleOrNull()
            val sec = if (kind.hasSecondary) secondary.trim().toDoubleOrNull() else null
            when {
                primary == null -> error = "Enter a number for ${kind.label.lowercase()}."
                kind.hasSecondary && sec == null -> error = "Enter both numbers (e.g. 120 and 80)."
                else -> scope.launch {
                    saving = true; error = null
                    when (val r = vm.logVital(kind.key, primary, sec, istNowIso(), note)) {
                        is WriteResult.Ok -> onClose()
                        is WriteResult.Err -> { saving = false; error = r.message }
                    }
                }
            }
        },
    ) {
        Dropdown("Reading", LOGGABLE_VITALS, kind, { it.label }) { kind = it }
        FormField(value, { value = it }, if (kind.hasSecondary) "Systolic (${kind.unit})" else "${kind.label} (${kind.unit})", KeyboardType.Number)
        if (kind.hasSecondary) FormField(secondary, { secondary = it }, "Diastolic (${kind.unit})", KeyboardType.Number)
        FormField(note, { note = it }, "Note (optional)", singleLine = false)
    }
}

// ── Medications ──────────────────────────────────────────────────────────────

private val FREQUENCIES = listOf(
    "Once daily" to 1, "Twice daily" to 2, "Three times daily" to 3, "Four times daily" to 4, "As needed" to 0,
)

@Composable
fun MedicationsList(state: RecordsUiState, vm: RecordsViewModel, onBack: () -> Unit) {
    var showAdd by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    RecordsScaffold(
        title = "Medications", onBack = onBack, state = state, onRetry = { vm.reload() },
        action = {
            val p = (state as? RecordsUiState.Ready)?.payload
            if (p != null && !omitted(p, "medications")) AddAction("Add") { showAdd = true }
        },
    ) { p ->
        when {
            omitted(p, "medications") -> AccountLevelNote()
            p.medications.isEmpty() -> EmptyState("No medications yet — add one to keep track.")
            else -> LazyColumn(Modifier.fillMaxSize()) {
                items(p.medications, key = { it.id }) { m ->
                    val sub = listOfNotNull(m.dose, m.scheduledTimes?.joinToString(", ")).filter { it.isNotBlank() }.joinToString(" · ")
                    ListRow(
                        title = m.name,
                        subtitle = sub.ifBlank { formatDay(m.startDate) },
                        trailing = { if (m.source == "manual") DeleteIcon { confirmDelete = m.id } },
                        onClick = {},
                    )
                }
            }
        }
    }

    if (showAdd) AddMedicationDialog(vm) { showAdd = false }
    confirmDelete?.let { id ->
        ConfirmDeleteDialog("This medication will be removed.", onConfirm = {
            confirmDelete = null; scope.launch { vm.deleteMedication(id) }
        }, onDismiss = { confirmDelete = null })
    }
}

@Composable
private fun AddMedicationDialog(vm: RecordsViewModel, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var dose by remember { mutableStateOf("") }
    var freq by remember { mutableStateOf(FREQUENCIES.first()) }
    var reason by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    FormDialog(
        title = "Add a medication", saving = saving, error = error, saveLabel = "Save", onDismiss = onClose,
        onSave = {
            when {
                name.isBlank() || dose.isBlank() -> error = "Enter the medicine name and dose."
                else -> scope.launch {
                    saving = true; error = null
                    when (val r = vm.addMedication(name.trim(), dose.trim(), freq.first, freq.second, null, null, reason)) {
                        is WriteResult.Ok -> onClose()
                        is WriteResult.Err -> { saving = false; error = r.message }
                    }
                }
            }
        },
    ) {
        FormField(name, { name = it }, "Medicine name")
        FormField(dose, { dose = it }, "Dose (e.g. 500 mg)")
        Dropdown("Frequency", FREQUENCIES, freq, { it.first }) { freq = it }
        FormField(reason, { reason = it }, "Reason (optional)", singleLine = false)
    }
}

// ── Conditions ───────────────────────────────────────────────────────────────

@Composable
fun ConditionsList(state: RecordsUiState, vm: RecordsViewModel, onBack: () -> Unit) {
    var showAdd by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    RecordsScaffold(
        title = "Conditions", onBack = onBack, state = state, onRetry = { vm.reload() },
        action = { AddAction("Add") { showAdd = true } },
    ) { p ->
        if (p.conditions.isEmpty()) EmptyState("No conditions recorded yet.")
        else LazyColumn(Modifier.fillMaxSize()) {
            items(p.conditions, key = { it.id }) { c ->
                ListRow(
                    title = c.label,
                    subtitle = formatDay(c.notedAt ?: c.createdAt),
                    trailing = { if (c.source == "patient") DeleteIcon { confirmDelete = c.id } },
                    onClick = {},
                )
            }
        }
    }

    if (showAdd) SimpleLabelDialog(
        title = "Add a condition", fieldLabel = "Condition", vm = vm,
        onSave = { label, notes -> vm.addCondition(label, null, null, notes) }, onClose = { showAdd = false },
    )
    confirmDelete?.let { id ->
        ConfirmDeleteDialog("This condition will be removed.", onConfirm = {
            confirmDelete = null; scope.launch { vm.deleteCondition(id) }
        }, onDismiss = { confirmDelete = null })
    }
}

// ── Allergies ────────────────────────────────────────────────────────────────

private val SEVERITIES = listOf("Mild" to "mild", "Moderate" to "moderate", "Severe" to "severe")

@Composable
fun AllergiesList(state: RecordsUiState, vm: RecordsViewModel, onBack: () -> Unit) {
    var showAdd by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    RecordsScaffold(
        title = "Allergies", onBack = onBack, state = state, onRetry = { vm.reload() },
        action = { AddAction("Add") { showAdd = true } },
    ) { p ->
        if (p.allergies.isEmpty()) EmptyState("No allergies recorded yet.")
        else LazyColumn(Modifier.fillMaxSize()) {
            items(p.allergies, key = { it.id }) { a ->
                ListRow(
                    title = a.label,
                    subtitle = a.reaction ?: formatDay(a.notedAt ?: a.createdAt),
                    trailing = {
                        Pill(severityPill(a.severity))
                        if (a.source == "patient") { Spacer(Modifier.width(4.dp)); DeleteIcon { confirmDelete = a.id } }
                    },
                    onClick = {},
                )
            }
        }
    }

    if (showAdd) AddAllergyDialog(vm) { showAdd = false }
    confirmDelete?.let { id ->
        ConfirmDeleteDialog("This allergy will be removed.", onConfirm = {
            confirmDelete = null; scope.launch { vm.deleteAllergy(id) }
        }, onDismiss = { confirmDelete = null })
    }
}

@Composable
private fun AddAllergyDialog(vm: RecordsViewModel, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var label by remember { mutableStateOf("") }
    var severity by remember { mutableStateOf(SEVERITIES.first()) }
    var reaction by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    FormDialog(
        title = "Add an allergy", saving = saving, error = error, saveLabel = "Save", onDismiss = onClose,
        onSave = {
            when {
                label.isBlank() -> error = "Please enter an allergy."
                else -> scope.launch {
                    saving = true; error = null
                    when (val r = vm.addAllergy(label.trim(), severity.second, reaction, null, null)) {
                        is WriteResult.Ok -> onClose()
                        is WriteResult.Err -> { saving = false; error = r.message }
                    }
                }
            }
        },
    ) {
        FormField(label, { label = it }, "Allergy")
        Dropdown("Severity", SEVERITIES, severity, { it.first }) { severity = it }
        FormField(reaction, { reaction = it }, "Reaction (optional)", singleLine = false)
    }
}

// ── Documents ────────────────────────────────────────────────────────────────

@Composable
fun DocumentsList(state: RecordsUiState, vm: RecordsViewModel, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) scope.launch {
            busy = true; error = null
            when (val r = vm.uploadDocument(uri)) {
                is WriteResult.Ok -> {}
                is WriteResult.Err -> error = r.message
            }
            busy = false
        }
    }

    RecordsScaffold(
        title = "Documents", onBack = onBack, state = state, onRetry = { vm.reload() },
        action = { if (!busy) AddAction("Upload") { picker.launch("*/*") } else UploadingChip() },
    ) { p ->
        Column(Modifier.fillMaxSize()) {
            if (error != null) Text(error!!, color = androidx.compose.material3.MaterialTheme.colorScheme.error, fontSize = 13.sp, modifier = Modifier.padding(16.dp))
            if (p.documents.isEmpty()) EmptyState("No documents yet. Use Upload above to add a report, prescription, or scan.")
            else LazyColumn(Modifier.fillMaxSize()) {
                items(p.documents, key = { it.id }) { d ->
                    ListRow(
                        title = d.label?.ifBlank { null } ?: docTypeLabel(d.docType),
                        subtitle = "${docTypeLabel(d.docType)} · ${formatFileSize(d.fileSizeBytes)} · ${formatDay(d.uploadedAt)}",
                        trailing = { ActionText("Open") },
                        onClick = {
                            scope.launch {
                                val url = vm.documentSignedUrl(d.id)
                                if (url != null) RecordOpen.openInCustomTab(context, url)
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun UploadingChip() {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 8.dp)) {
        androidx.compose.material3.CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(16.dp), color = SanocareBlue)
        Spacer(Modifier.width(6.dp))
        Text("Uploading…", color = InkMute, fontSize = 13.sp)
    }
}

private fun docTypeLabel(docType: String): String = when (docType) {
    "lab_report" -> "Lab report"
    "prescription" -> "Prescription"
    "imaging" -> "Imaging"
    "discharge_summary" -> "Discharge summary"
    else -> docType.split('_').joinToString(" ") { it.replaceFirstChar { c -> c.uppercase() } }.ifBlank { "Document" }
}

private fun formatFileSize(bytes: Long): String {
    if (bytes <= 0) return "—"
    if (bytes < 1024) return "$bytes B"
    val kb = bytes / 1024.0
    if (kb < 1024) return "${if (kb < 10) String.format("%.1f", kb) else kb.toLong().toString()} KB"
    val mb = kb / 1024.0
    return "${if (mb < 10) String.format("%.1f", mb) else mb.toLong().toString()} MB"
}

// ── Shared: a label + notes dialog (conditions) ──────────────────────────────

@Composable
private fun SimpleLabelDialog(
    title: String,
    fieldLabel: String,
    vm: RecordsViewModel,
    onSave: suspend (label: String, notes: String) -> WriteResult,
    onClose: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var label by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    FormDialog(
        title = title, saving = saving, error = error, saveLabel = "Save", onDismiss = onClose,
        onSave = {
            when {
                label.isBlank() -> error = "Please enter a ${fieldLabel.lowercase()}."
                else -> scope.launch {
                    saving = true; error = null
                    when (val r = onSave(label.trim(), notes)) {
                        is WriteResult.Ok -> onClose()
                        is WriteResult.Err -> { saving = false; error = r.message }
                    }
                }
            }
        },
    ) {
        FormField(label, { label = it }, fieldLabel)
        FormField(notes, { notes = it }, "Notes (optional)", singleLine = false)
    }
}
