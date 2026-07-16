package `in`.sanocare.pulse.ui.shell

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.sanocare.pulse.data.network.FamilyMemberDto
import `in`.sanocare.pulse.data.records.MemberScopeStore
import `in`.sanocare.pulse.data.records.RecordsRepository
import `in`.sanocare.pulse.data.records.SelectedMember
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

// PB3 — backs the top-bar member chip + switcher sheet. Loads the family members
// once and writes them into the shared MemberScopeStore, so the switcher and the
// Records surface read the same source of truth. Selecting a member re-scopes
// every read/write (the Records VM observes the store and reloads).

@HiltViewModel
class ShellViewModel @Inject constructor(
    private val repo: RecordsRepository,
    private val scope: MemberScopeStore,
) : ViewModel() {

    val selected: StateFlow<SelectedMember> = scope.selected
    val members: StateFlow<List<FamilyMemberDto>> = scope.members

    init {
        viewModelScope.launch { scope.setMembers(repo.familyMembers()) }
    }

    fun selectSelf() = scope.selectSelf()
    fun selectMember(m: FamilyMemberDto) = scope.selectMember(m)
}
