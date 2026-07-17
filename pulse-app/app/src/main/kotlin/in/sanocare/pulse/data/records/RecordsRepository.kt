package `in`.sanocare.pulse.data.records

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import dagger.hilt.android.qualifiers.ApplicationContext
import `in`.sanocare.pulse.data.auth.PulseAuthStore
import `in`.sanocare.pulse.data.network.AllergyAddRequest
import `in`.sanocare.pulse.data.network.ConditionAddRequest
import `in`.sanocare.pulse.data.network.FamilyMemberDto
import `in`.sanocare.pulse.data.network.MedicationAddRequest
import `in`.sanocare.pulse.data.network.PulseWriteApi
import `in`.sanocare.pulse.data.network.RecordsApi
import `in`.sanocare.pulse.data.network.RecordsPayload
import `in`.sanocare.pulse.data.network.VitalLogRequest
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Response
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

// PB2/PB3 — Records read + write repository. Reads via the ONE aggregated
// /api/pulse/records (member-scoped from MemberScopeStore); writes reuse the
// existing per-category endpoints. member_id on member-aware writes comes from
// the scope store (the server re-verifies ownership). Read-only categories and
// account-level ones are unaffected. Read-only; no schema/route changes.

@Singleton
class RecordsRepository @Inject constructor(
    private val api: RecordsApi,
    private val writeApi: PulseWriteApi,
    private val scope: MemberScopeStore,
    private val authStore: PulseAuthStore,
    @ApplicationContext private val context: Context,
) {

    suspend fun load(): RecordsResult = runCatching {
        val res = api.records(scope.memberParam())
        if (res.code() == 401) {
            authStore.clear()
            return@runCatching RecordsResult.Unauthorized
        }
        val body = res.body()
        if (!res.isSuccessful || body?.records == null) {
            return@runCatching RecordsResult.Error(body?.error ?: "Couldn't load your records.")
        }
        RecordsResult.Data(body.records)
    }.getOrElse { RecordsResult.Error(it.message ?: "Network error") }

    suspend fun downloadReceipt(bookingId: String, bookingCode: String?): File? = runCatching {
        val res = api.receipt(bookingId)
        if (res.code() == 401) { authStore.clear(); return@runCatching null }
        if (!res.isSuccessful) return@runCatching null
        val bytes = res.body()?.bytes() ?: return@runCatching null
        val dir = File(context.cacheDir, "receipts").apply { mkdirs() }
        val safe = (bookingCode ?: bookingId).replace(Regex("[^A-Za-z0-9._-]"), "_")
        File(dir, "Sanocare-Receipt-$safe.pdf").apply { writeBytes(bytes) }
    }.getOrElse { null }

    // ── Family members (switcher) ────────────────────────────────────────────
    suspend fun familyMembers(): List<FamilyMemberDto> = runCatching {
        val res = writeApi.familyMembers()
        if (res.isSuccessful) res.body()?.members ?: emptyList() else emptyList()
    }.getOrElse { emptyList() }

    // ── Vitals + Medications (account-level; no member_id) ────────────────────
    suspend fun logVital(kind: String, valueNumeric: Double, valueSecondary: Double?, takenAtIso: String, note: String?): WriteResult =
        call { writeApi.logVital(VitalLogRequest(kind, valueNumeric, valueSecondary, takenAtIso, note?.ifBlank { null })) }

    suspend fun deleteVital(id: String): WriteResult = call { writeApi.deleteVital(id) }

    suspend fun addMedication(name: String, dose: String, frequencyLabel: String, timesPerDay: Int, startDate: String?, endDate: String?, reason: String?): WriteResult =
        call { writeApi.addMedication(MedicationAddRequest(name, dose, frequencyLabel, timesPerDay, startDate, endDate, reason?.ifBlank { null })) }

    suspend fun deleteMedication(id: String): WriteResult = call { writeApi.deleteMedication(id) }

    // ── Conditions + Allergies (member-scoped via the scope store) ────────────
    suspend fun addCondition(label: String, status: String?, notedAt: String?, notes: String?): WriteResult =
        call { writeApi.addCondition(ConditionAddRequest(label, status, notedAt, notes?.ifBlank { null }, scope.memberIdOrNull())) }

    suspend fun deleteCondition(id: String): WriteResult = call { writeApi.deleteCondition(id) }

    suspend fun addAllergy(label: String, severity: String?, reaction: String?, notedAt: String?, notes: String?): WriteResult =
        call { writeApi.addAllergy(AllergyAddRequest(label, severity, reaction?.ifBlank { null }, null, notedAt, notes?.ifBlank { null }, scope.memberIdOrNull())) }

    suspend fun deleteAllergy(id: String): WriteResult = call { writeApi.deleteAllergy(id) }

    // ── Documents (multipart upload + signed-URL open; member-scoped) ─────────
    suspend fun uploadDocument(uri: Uri, docType: String?): WriteResult = runCatching {
        val resolver = context.contentResolver
        val mime = resolver.getType(uri) ?: "application/octet-stream"
        val name = displayName(uri) ?: "upload"
        val bytes = resolver.openInputStream(uri)?.use { it.readBytes() }
            ?: return@runCatching WriteResult.Err("Couldn't read that file.")
        val filePart = MultipartBody.Part.createFormData("file", name, bytes.toRequestBody(mime.toMediaTypeOrNull()))
        val docTypePart = docType?.toRequestBody("text/plain".toMediaTypeOrNull())
        val memberPart = scope.memberIdOrNull()?.toRequestBody("text/plain".toMediaTypeOrNull())
        writeApi.uploadDocument(filePart, docTypePart, memberPart).toWrite()
    }.getOrElse { WriteResult.Err(it.message ?: "Upload failed") }

    suspend fun documentSignedUrl(docId: String): String? = runCatching {
        val res = writeApi.documentSignedUrl(docId)
        if (res.code() == 401) authStore.clear()
        if (res.isSuccessful) res.body()?.url else null
    }.getOrElse { null }

    // ── helpers ───────────────────────────────────────────────────────────────
    private suspend fun call(block: suspend () -> Response<Unit>): WriteResult =
        runCatching { block().toWrite() }.getOrElse { WriteResult.Err(it.message ?: "Network error") }

    private fun Response<Unit>.toWrite(): WriteResult {
        if (code() == 401) { authStore.clear(); return WriteResult.Err("Please sign in again.") }
        if (isSuccessful) return WriteResult.Ok
        return WriteResult.Err(parseError(errorBody()?.string()))
    }

    private fun displayName(uri: Uri): String? = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    }.getOrNull()

    private fun parseError(body: String?): String {
        if (body.isNullOrBlank()) return "Something went wrong. Try again."
        val i = body.indexOf("\"error\"")
        if (i < 0) return "Something went wrong. Try again."
        val start = body.indexOf('"', i + 8)
        val end = body.indexOf('"', start + 1)
        return if (start in 0 until end) body.substring(start + 1, end) else "Something went wrong. Try again."
    }
}

sealed interface RecordsResult {
    data class Data(val payload: RecordsPayload) : RecordsResult
    data object Unauthorized : RecordsResult
    data class Error(val message: String) : RecordsResult
}

sealed interface WriteResult {
    data object Ok : WriteResult
    data class Err(val message: String) : WriteResult
}
