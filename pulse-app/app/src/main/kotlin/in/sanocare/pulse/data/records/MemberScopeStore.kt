package `in`.sanocare.pulse.data.records

import `in`.sanocare.pulse.data.network.FamilyMemberDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

// PB3 — the app-wide "who am I viewing" scope. A single source of truth shared
// by the shell (member chip + switcher) and the Records surface, so selecting a
// family member re-scopes every read (?member=) and write (member_id) at once.
// "Self" is the default. The server still re-verifies member ∈ this customer.

@Singleton
class MemberScopeStore @Inject constructor() {

    private val _selected = MutableStateFlow<SelectedMember>(SelectedMember.Self)
    val selected: StateFlow<SelectedMember> = _selected.asStateFlow()

    private val _members = MutableStateFlow<List<FamilyMemberDto>>(emptyList())
    val members: StateFlow<List<FamilyMemberDto>> = _members.asStateFlow()

    fun setMembers(list: List<FamilyMemberDto>) {
        _members.value = list
        // If the selected member vanished (e.g. removed elsewhere), fall back to Self.
        val sel = _selected.value
        if (sel is SelectedMember.Member && list.none { it.id == sel.id }) {
            _selected.value = SelectedMember.Self
        }
    }

    fun selectSelf() { _selected.value = SelectedMember.Self }
    fun selectMember(m: FamilyMemberDto) { _selected.value = SelectedMember.Member(m.id, m.name) }

    /** `?member=` value for GET /api/pulse/records. */
    fun memberParam(): String = when (val s = _selected.value) {
        SelectedMember.Self -> "self"
        is SelectedMember.Member -> s.id
    }

    /** member_id for writes; null = account holder. */
    fun memberIdOrNull(): String? = when (val s = _selected.value) {
        SelectedMember.Self -> null
        is SelectedMember.Member -> s.id
    }
}

sealed interface SelectedMember {
    data object Self : SelectedMember
    data class Member(val id: String, val name: String) : SelectedMember
}
