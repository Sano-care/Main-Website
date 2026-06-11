"use client";

import {
  useViewingFirstName,
  useViewingMember,
} from "../../_lib/MemberViewingContext";

/**
 * T90 Pulse v1 Phase 1 Slice 2 — Greeting sub-line.
 *
 * "Viewing care for {firstName}" — renders only when the active
 * viewing target is a family member (not self). Reads viewing state
 * from MemberViewingContext, so it's a tiny client component sitting
 * adjacent to the server-rendered greeting heading.
 *
 * Hydration cost is acceptable per brief — the sub-line is conditional
 * UX context, not the primary greeting. SSR renders nothing here; the
 * line fades in on hydrate when applicable.
 */
export default function ViewingSubLine() {
  const { viewing } = useViewingMember();
  const firstName = useViewingFirstName();
  if (viewing.kind === "self") return null;
  return (
    <p className="mt-1 text-sm text-gray-500">
      Viewing care for {firstName}
    </p>
  );
}
