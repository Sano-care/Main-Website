# T64 Brief Patch — Plan-Gate Resolution

**Status:** APPROVED (founder greenlit 2026-06-08)
**Supersedes:** T64 brief (in-chat, 2026-06-08, "Family Members + Account-Aware Booking")
**Branch:** `t64-pr1-family-members` (off main HEAD `b3c1240`, "Pulse v0.1 polish")
**Author:** Claude Code (recon) + founder (plan-gate decisions)

This document captures the six divergences between the original T64 brief
and the actual codebase, plus the founder's resolution for each. It is the
canonical spec for PR1 and PR2; the original in-chat brief is treated as
informational background where it doesn't conflict with what's recorded
here. Per the working agreement, divergences are also surfaced inline in
source comments and commit messages as the code lands.

---

## Six divergences with resolutions

### Divergence 1 — RLS approach

**Brief said:** Define RLS policies on `family_members` using `auth.uid()`.

**Codebase reality:** No Supabase Auth. Identity is held by a signed OTP
cookie (`sanocare_otp_verify`) that resolves phone → `customers.id`
server-side via `getCurrentCustomer()`. `auth.uid()` always returns NULL
in this codebase. Established precedent: M035 (`vital_readings`) and
M036 (`medications`) define **no RLS policies**; ownership is enforced
in `/api/pulse/*` handlers via `getCurrentCustomer()` + service-role
queries scoped by `customer_id`.

**Resolution:** Match precedent. No RLS on `family_members`. All
`/api/pulse/family-members/*` routes resolve `getCurrentCustomer()` and
include `WHERE customer_id = <resolved id>` in every query. Service-role
client only.

### Divergence 2 — Account-owner table is `customers`, not `patients`

**Brief said:** `account_id uuid NOT NULL REFERENCES patients(id)`.

**Codebase reality:** No `patients` table. The account-owner table is
`customers` (M013), keyed by phone (M016 enforces unique). `bookings`
already FKs to it via `bookings.customer_id` (M013).

**Resolution:** Propagate "customers" throughout T64. Schema field name
is `customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE`
on `family_members`. The brief's `account_id` naming becomes `customer_id`
everywhere — table column, TypeScript types, route handler param names,
log lines.

### Divergence 3 — IdentifyStep: wrap (not modify)

**Brief said:** Modify `IdentifyStep.tsx` to embed `MemberPicker` above
the name field.

**Codebase reality:** The T85 author left a source comment in
`IdentifyStep.tsx` (lines 12–19) explicitly anticipating T64:

> *"T64 prop API: `onComplete({ name, phone })` is the hand-off seam
> the family-member-picker (T64) will widen to `{ name, phone, member }`
> without changing this file's contract. PR4a passes the simple
> payload; T64 **wraps** this component with the picker and adds the
> member field before calling the parent's onComplete."*

The wrap intent was designed in.

**Resolution:** Build a new `MemberPickerStep` component as Step 0 in
the booking modal. Branch on selection:

- "Self" tile → render existing `IdentifyStep` unchanged (collects name).
- Member tile → skip `IdentifyStep` entirely; member's name comes from
  the row.

`IdentifyStep.tsx` is **not modified** by T64. Its `onComplete` contract
stays `(payload: IdentifyPayload) => void` with `IdentifyPayload = { name, phone }`.

The widened payload `{ name, phone, member }` propagates through a
higher-level orchestrator (the booking modal itself), not through
IdentifyStep's prop API.

### Divergence 4 — Migration numbering: PR0-step cleanup

**Brief said:** T64 lands as M042 (or M041 if no prior M041 candidate).

**Codebase reality:** Two files at M040 on main:
- `040_partial_paid_status.sql` (PR #42, applied to prod)
- `040_paid_click_log_gclid.sql` (PR #43, **never applied to prod** —
  committed only)

**Resolution:** PR1 includes a small PR0-style cleanup commit:
1. `git mv 040_paid_click_log_gclid.sql → 041_paid_click_log_gclid.sql`
2. Apply M041 to prod via `apply_migration` MCP (after founder verbatim
   eyeball of the SQL — see below).
3. T64's `family_members` migration lands as **M042**.

The gclid migration body is additive + idempotent (`ADD COLUMN IF NOT
EXISTS`, `CREATE INDEX IF NOT EXISTS`) so applying it now is safe.

### Divergence 5 — Pulse navigation: extend ProfileMenu (no new hamburger)

**Brief said:** Add a new hamburger menu component (`HamburgerMenu.tsx`)
with a Family Members entry.

**Codebase reality (post-PR #34):** `ProfileMenu` already exists at
`src/app/pulse/_components/ProfileMenu.tsx`, mounted in two variants
(`chip` on home greeting band, `icon` on interior page headers). Its
file header comment explicitly designates it the T64 plug-in point:

> *"Tapping either opens a small dropdown whose only item (for now) is
> 'Sign out' → POST /api/pulse/signout (clears the verify cookie) →
> hard-navigate to /pulse/login. **T64 will add family-member switching
> as additional items here.**"*

**Resolution:** Extend `ProfileMenu` with a "Family Members" menu entry
between the user name header and the "Sign out" item. Also surface a
tile on `/pulse` home next to Vitals + Medications for primary
discovery. No new hamburger component; the existing ProfileMenu IS the
hamburger in disguise.

### Divergence 6 — PR #34 ordering dependency (resolved by landing #34 first)

**Brief said:** (Implicit — no mention of PR #34.)

**Codebase reality at plan-gate time:** ProfileMenu existed only on the
unmerged `pulse-v0-polish` branch (PR #34). T64's Option D for
divergence 5 depends on ProfileMenu being on main.

**Resolution:** Founder UAT'd preview-34, greenlit, PR #34 landed as
commit `b3c1240` on main with tag `pulse-v0.1-polish` (2026-06-08).
T64 PR1 branches off this commit. No stacking required.

---

## Plan-gate answers (founder picks, 2026-06-08)

| Question | Founder pick |
|---|---|
| Q1 — RLS approach | API-only scoping (no RLS on family_members) |
| Q2 — Picker shape | Wrap as new Step 0 (`MemberPickerStep`) |
| Q3 — M040 cleanup | PR0-step: renumber gclid → M041 + apply, T64 = M042 |
| Q4 — Hamburger | Extend ProfileMenu + tile on /pulse home (Option D) |

| Copy / UX item | Resolved value |
|---|---|
| Delete confirmation copy | "Delete {name} from family? Past bookings stay in your history." |
| AddMember submit (new) | "Add to family" |
| AddMember submit (edit) | "Save changes" |
| Member tile selected state | Coral 2px border + coral-tinted bg (matches `CouponSection.tsx` Tailwind classes) |

---

## PR1 sequence (this branch)

Order of commits:

1. **Commit 1 (this commit):** Branch setup
   - `git mv 040_paid_click_log_gclid.sql → 041_paid_click_log_gclid.sql`
   - `T64_BRIEF_PATCH.md` (this file) at repo root

2. **Founder verbatim eyeball + approval of M041 SQL** — see Section
   "M041 SQL for verbatim review" below.

3. **Commit 2:** Apply M041 to prod via `apply_migration` MCP.
   - This is a record-only commit (no file changes); the actual
     application happens via MCP. The commit message documents the
     apply for audit.

4. **Founder verbatim eyeball + approval of M042 SQL.**

5. **Commit 3:** Add `supabase/migrations/042_family_members.sql`
   artifact to branch.

6. **Apply M042 to prod via MCP.**

7. **Commits 4+: PR1 code** (in this order, separable commits)
   - `src/lib/family-members/types.ts` (TypeScript types)
   - `src/lib/family-members/relations.ts` (enum + display labels + DOB
     → age helper)
   - `src/app/api/pulse/family-members/route.ts` (GET, POST)
   - `src/app/api/pulse/family-members/[id]/route.ts` (PATCH, DELETE)
   - `src/app/pulse/family-members/page.tsx` (server component, gated
     via `PulseShell`)
   - `src/app/pulse/family-members/_components/MemberCard.tsx`
   - `src/app/pulse/family-members/_components/AddMemberForm.tsx`
     (modal/sheet with `useScrollLock`)
   - Extend `src/app/pulse/_components/ProfileMenu.tsx` with
     "Family Members" entry
   - Add tile to `src/app/pulse/page.tsx` next to Vitals + Medications

8. **Final commit:** `npm run build` clean confirmation in commit
   message; preview UAT before merge.

---

## PR2 sequence (separate branch, cuts off updated main after PR1 merges)

Branch: `t64-pr2-booking-integration`

Order of commits:

1. `src/components/booking/steps/MemberPickerStep.tsx` (new Step 0
   component) + `src/components/booking/steps/_components/InlineAddMember.tsx`
   (quick-add wrapping `AddMemberForm` from PR1).

2. Extend `src/store/bookingStore.ts` with `selectedMember: FamilyMember | null`
   + `coordinationPhone: string | null`. **NOT** added to `partialize`
   allow-list — fresh per booking to avoid stale refs.

3. `src/lib/booking/contextFormat.ts` — extend `formatLeadAlertContext`
   signature with optional `member?: { relationLabel, ageY, notes }`.
   Format becomes:
   - Self: `{notes or "—"} | Paid ₹X of ₹Y (mode_description)` (unchanged from PR4b)
   - Member: `{relation_label} ({age}y) | {notes or "—"} | Paid ₹X of ₹Y (mode_description)`

4. `src/lib/booking/rampwin.ts` (sender) — `{{1}}` and `{{2}}` derive
   from member when selected, from booking-form values when Self.
   `{{6}}` (patient phone) continues to use the account phone (the
   coordinationPhone goes into ops_notes or a separate ops surface, NOT
   the alert).

5. `src/app/api/razorpay/verify/route.ts` — accept `member_id` +
   `coordination_phone` in request body, persist on bookings row, pass
   through to `formatLeadAlertContext` + sender.

6. `src/app/api/lab/create-booking-prepaid/route.ts` — same as verify
   route.

7. Wire `MemberPickerStep` as Step 0 in `ServiceLedBookingModal` +
   `LabBasketWindow`. Conditional Step 1 render: when Self,
   IdentifyStep renders as today; when member selected, skip to Step 2.

8. Extend `WhereWhenStep.tsx` with the `coordination_phone` input
   (visible only when a non-Self member is selected).

9. Smoke test on prod after merge: complete one Self booking + one
   member booking, verify both alerts arrive with correct `{{1}}`,
   `{{2}}`, `{{5}}` values.

---

## Out-of-scope reminders (carry from brief)

These DO NOT land in T64:

- Per-member separate phone / OTP / auth.
- Per-member records view (T70).
- Per-member personal details edit beyond name/DOB/relation (T71).
- Per-member booking history view (T72).
- Cross-account family sharing.
- Auto-create "Self" `family_members` row at signup.
- Backfill of existing 57 prod bookings (all stay `member_id = NULL` =
  Self).
- B2B2C CareHub integration.
- Soft-delete + reactivation (hard delete with confirmation).
- Family-member quick-search UI (hard cap 8 means tile grid suffices).

---

## Self representation in the data model (confirmed)

For v1: **"Self" is a virtual UI concept, not a stored row.**

- `bookings.member_id = NULL` → booking is for Self / account owner.
- Self's name + phone are collected on the booking form per-booking,
  as in current T85 behavior.
- Family members are real `family_members` rows with stored name + DOB.

Rationale: simplest. No migration of 57 existing rows. No Self-row
creation at signup. The alternative (auto-create Self) becomes
attractive only when Pulse v2 brings account-level profile editing —
deferred to a future ticket.

---

## bookingStore additions (PR2 spec)

```ts
type BookingState = {
  // ... existing fields ...
  selectedMember: FamilyMember | null;  // NOT in partialize — stale risk
  coordinationPhone: string | null;     // NOT in partialize — clear per booking
  // ... existing fields ...
};
```

The persistence exclusion is important: `selectedMember` snapshots a
row that could be edited or deleted between sessions. Resolving fresh
per booking from the API keeps the modal state honest.
`coordinationPhone` shouldn't leak from a prior relative to a new
booking.

---

## DOB → age helper (PR1)

`src/lib/family-members/relations.ts` exposes:

```ts
export function ageYearsFromDob(dob: string | Date | null): number | null;
```

Pure function. Floor-divides by 365.25 days. Returns `null` when `dob`
is null. The `{{2}}` template variable uses `${age}y` when non-null,
falling back to `—y` (matches current T85 behavior for the no-age
case).

---

## Acceptance criteria — Definition of Done (unchanged from brief)

PR1:
- M041 (gclid renumber) applied to prod ✓ when prod has the column
- M042 (family_members) applied to prod ✓ when prod has the table
- `/pulse/family-members` route reachable behind Pulse auth
- CRUD works end-to-end (add / edit / delete / list)
- 8-member cap enforced via DB trigger; 9th insert surfaces clean error
- ProfileMenu has "Family Members" entry; /pulse home has the tile
- API-layer scoping verified — two test accounts can't see each other's
  members
- `npm run build` clean

PR2:
- MemberPickerStep mounts as Step 0 in both ServiceLedBookingModal +
  LabBasketWindow
- No tile pre-selected — explicit pick every time
- Self → IdentifyStep renders; Member → IdentifyStep auto-skipped
- `bookings.member_id` + `bookings.coordination_phone` persist correctly
- Smoke test: one Self booking + one member booking — both
  `aarogya_lead_alert` arrive with correct `{{1}}`, `{{2}}`, `{{5}}`
- `npm run build` clean

---

## Reference

Original brief: in-session chat, 2026-06-08, titled "T64 — Family
Members + Account-Aware Booking (Sanocare Pulse v1)". Sections not
contradicted by the six divergences above continue to apply (color +
UX discipline, working agreement, file list, etc.).

This brief patch moves to `archive/briefs/` once prod matches PR1 + PR2.
