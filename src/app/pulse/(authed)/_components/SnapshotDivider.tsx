"use client";

import {
  useViewingFirstName,
  useViewingMember,
} from "../../_lib/MemberViewingContext";

/**
 * T90 Pulse v1 Phase 1 Slice 2 — Section divider between the tile
 * grid and the snapshot cards (vitals / meds / family).
 *
 * Label tracks the active viewing target:
 *   self                → "Your snapshot"
 *   family member (Mom) → "Mom's snapshot"
 *
 * Step 11 ships the divider always-visible. Step 17 cleanup may add
 * a conditional-hide when the viewing member has zero data across
 * vitals + meds + family (i.e., a totally fresh family member with
 * no readings logged yet) — deferred to keep this step small.
 */
export default function SnapshotDivider() {
  const { viewing } = useViewingMember();
  const firstName = useViewingFirstName();
  const label =
    viewing.kind === "self" ? "Your snapshot" : `${firstName}'s snapshot`;

  return (
    <div className="my-2 flex items-center gap-3 text-[11px] font-bold uppercase tracking-wider text-gray-500">
      <span className="h-px flex-1 bg-gray-200" aria-hidden="true" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-gray-200" aria-hidden="true" />
    </div>
  );
}
