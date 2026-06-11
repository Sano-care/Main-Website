"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { FamilyMember } from "@/lib/family-members/types";

import { useCurrentCustomer } from "./PulseCustomerContext";

/**
 * T90 Pulse v1 Phase 1 — "Who are you viewing?" state.
 *
 * Brief implies the entire app (vitals, meds, profile, snapshot label,
 * booking pre-fill) rescopes to the active viewing member. This provider
 * owns that state and persists it locally so refresh + close-and-reopen
 * keep the user on the same view.
 *
 * Persistence model (founder direction, Step 06 design note):
 *   - localStorage key: `pulse_viewing_member_id:{customer.id}`
 *   - Value: family_members.id (string) OR absent for self
 *   - Scoped by customer.id so different account holders on the same
 *     device don't share state
 *   - Default = self ({ kind: 'self' }) when no value stored
 *   - Self-heals: if the stored ID no longer matches a live member
 *     (deleted while stored), we wipe the key + fall back to self
 *
 * Not in scope for v1 (deferred to v1.1+ per founder direction):
 *   - URL search param `?member=` (bookmarkable)
 *   - DB-backed sticky-across-devices (`customers.last_viewed_member_id`)
 *
 * Where used: PulseAppBar (chip label), PulseDrawer ("Your profile"
 * subtitle), MemberSwitcherSheet (radio rows + setter). Step 12+
 * page rewrites will read this for vitals/meds/snapshot scoping.
 *
 * Provider mount point: <PulseChrome /> — wraps the entire authed Pulse
 * tree so every component under the chrome can call useViewingMember().
 * Login + (future) /pulse/welcome render outside PulseChrome and so do
 * NOT see this context — calling the hook there throws (intentional;
 * it's a bug to consume viewing state on an unauthenticated surface).
 */

type Viewing =
  | { kind: "self" }
  | { kind: "member"; member: FamilyMember };

interface MemberViewingValue {
  /** Full family-members list. Empty array until the fetch settles. */
  members: FamilyMember[];
  membersLoading: boolean;
  membersError: string | null;
  /** Current viewing target — resolved against the live members list. */
  viewing: Viewing;
  /** Pass null to switch to self; pass a member id to switch to that member. */
  setViewingId: (memberId: string | null) => void;
  /** Re-fetch the members list — call after an add/edit/delete. */
  refetchMembers: () => Promise<void>;
}

const MemberViewingContext = createContext<MemberViewingValue | null>(null);

function storageKey(customerId: string) {
  return `pulse_viewing_member_id:${customerId}`;
}

export function MemberViewingProvider({ children }: { children: ReactNode }) {
  const customer = useCurrentCustomer();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [viewingId, setViewingIdState] = useState<string | null>(null);
  const hydratedRef = useRef(false);

  const refetchMembers = useCallback(async () => {
    setMembersError(null);
    try {
      const res = await fetch("/api/pulse/family-members", {
        credentials: "include",
      });
      if (!res.ok) {
        setMembersError("Could not load family members.");
        return;
      }
      const data = (await res.json()) as { members?: FamilyMember[] };
      setMembers(Array.isArray(data?.members) ? data.members : []);
    } catch (err) {
      console.error("[MemberViewingProvider] members fetch failed", err);
      setMembersError("Could not load family members.");
    } finally {
      setMembersLoading(false);
    }
  }, []);

  // Initial fetch on mount. The provider mounts once per authenticated
  // pulse-tree render (PulseChrome is the parent), so this fires once
  // per page load.
  useEffect(() => {
    void refetchMembers();
  }, [refetchMembers]);

  // Hydrate `viewingId` from localStorage on first mount only. Subsequent
  // setViewingId calls drive the value going forward.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    try {
      const stored = window.localStorage.getItem(storageKey(customer.id));
      if (stored) setViewingIdState(stored);
    } catch {
      // localStorage unavailable (private mode, security policies, etc.).
      // Silently default to self — no user-facing degradation.
    }
  }, [customer.id]);

  const setViewingId = useCallback(
    (memberId: string | null) => {
      setViewingIdState(memberId);
      try {
        const key = storageKey(customer.id);
        if (memberId) {
          window.localStorage.setItem(key, memberId);
        } else {
          window.localStorage.removeItem(key);
        }
      } catch {
        // localStorage write failed — silent. In-memory state still updates,
        // so the current tab works; refresh loses the selection.
      }
    },
    [customer.id],
  );

  // Resolve the viewing object from the stored id + live members.
  // If the stored id no longer matches any member (deletion race), this
  // returns self; the self-heal effect below clears the stale key.
  let resolvedViewing: Viewing = { kind: "self" };
  if (viewingId) {
    const found = members.find((m) => m.id === viewingId);
    if (found) resolvedViewing = { kind: "member", member: found };
  }

  // Self-heal: clear stale localStorage when the stored id can't be
  // resolved AFTER the fetch has settled. Guarded on !membersLoading so
  // we don't wipe during the pre-fetch window.
  useEffect(() => {
    if (membersLoading) return;
    if (!viewingId) return;
    const stillExists = members.some((m) => m.id === viewingId);
    if (!stillExists) {
      try {
        window.localStorage.removeItem(storageKey(customer.id));
      } catch {
        // ignore — provider already fell back to self in resolvedViewing.
      }
      setViewingIdState(null);
    }
  }, [members, membersLoading, viewingId, customer.id]);

  return (
    <MemberViewingContext.Provider
      value={{
        members,
        membersLoading,
        membersError,
        viewing: resolvedViewing,
        setViewingId,
        refetchMembers,
      }}
    >
      {children}
    </MemberViewingContext.Provider>
  );
}

/**
 * The viewing state for the current Pulse session. Throws when called
 * outside <MemberViewingProvider /> — that always indicates a component
 * used a viewing-state hook on an unauthenticated surface (login,
 * welcome) where rescoping has no meaning. Surfacing it loudly beats
 * threading a null.
 */
export function useViewingMember(): MemberViewingValue {
  const ctx = useContext(MemberViewingContext);
  if (!ctx) {
    throw new Error(
      "useViewingMember() must be used within <MemberViewingProvider />",
    );
  }
  return ctx;
}

/**
 * Convenience derivation: the first-name string for the active viewing
 * target. Self uses the account-holder's first name; family member uses
 * the member's first name. Falls back to "You" for the edge case of a
 * null full_name (pre-name-capture session reaching an authed surface).
 */
export function useViewingFirstName(): string {
  const customer = useCurrentCustomer();
  const { viewing } = useViewingMember();
  if (viewing.kind === "self") return deriveFirstName(customer.full_name);
  return deriveFirstName(viewing.member.name);
}

function deriveFirstName(name: string | null): string {
  if (!name) return "You";
  const trimmed = name.trim();
  if (!trimmed) return "You";
  const first = trimmed.split(/\s+/)[0];
  return first.length > 0 ? first : "You";
}
