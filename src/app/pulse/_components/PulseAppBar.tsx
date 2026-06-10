"use client";

import Image from "next/image";
import Link from "next/link";

import { useCurrentCustomer } from "../_lib/PulseCustomerContext";
import {
  useViewingFirstName,
  useViewingMember,
} from "../_lib/MemberViewingContext";

/**
 * T90 Pulse v1 Phase 1 — Top app bar (Surface 2).
 *
 * Layout (brief spec, Surface 2):
 *   Mobile  ≤640px: [☰] [Sanocare lockup] [Mom ▼] [SA]      — 56px tall
 *   Desktop ≥640px: [☰] [Sanocare lockup] [Mom ▼] [Shashwat ▼] — 64px tall
 *
 * Visual:
 *   - White background, 1px bottom border `#E5E7EB`
 *   - Lockup is the canonical `/sanocare-lockup.svg`; tap routes to /pulse
 *   - Member chip: button-shaped, displays the active viewing member's
 *     first name (Step 06: now wired via useViewingFirstName). Chevron
 *     dims when the family-members list is empty AND we know it (i.e.,
 *     fetch settled) — visual cue that the switcher is sparse.
 *   - Avatar: 36px circle with first/last-initial of the ACCOUNT HOLDER
 *     (not the viewing target — the avatar is the account, not the view).
 *     Tap is still a structural placeholder until Step 07 wires
 *     <PulseAvatarMenu />.
 *
 * Hamburger is `lg:hidden` because on desktop ≥1024px the drawer becomes
 * an inline left rail (always visible) — no toggle needed. PulseChrome
 * passes onMenuClick which only fires on the mobile/tablet variant.
 *
 * Auth context: this is a client component nested under
 * <PulseCustomerProvider /> + <MemberViewingProvider /> (both from
 * PulseChrome). PulseChrome only mounts the AppBar when a customer
 * exists, so the throw-on-null paths never trigger on the login surface.
 */

interface PulseAppBarProps {
  onMenuClick: () => void;
  onMemberChipClick: () => void;
  onAvatarClick: () => void;
}

export default function PulseAppBar({
  onMenuClick,
  onMemberChipClick,
  onAvatarClick,
}: PulseAppBarProps) {
  const customer = useCurrentCustomer();
  const viewingFirstName = useViewingFirstName();
  const { members, membersLoading } = useViewingMember();
  const initials = deriveInitials(customer.full_name);

  // Dim the chevron when the user has no family members AND we've
  // confirmed it (post-fetch). Pre-fetch, keep the chevron at full
  // contrast so it doesn't flicker dim → bright on hydration.
  const chevronDimmed = !membersLoading && members.length === 0;

  return (
    <header
      className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-gray-200 bg-white px-3 lg:h-16 lg:px-6"
      role="banner"
    >
      {/* Left cluster: hamburger + lockup */}
      <div className="flex items-center gap-2 lg:gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open menu"
          className="-ml-1 inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 lg:hidden"
        >
          {/* Hamburger icon — inline SVG to avoid a lucide dep on first paint */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        </button>

        <Link
          href="/pulse"
          aria-label="Sanocare Pulse home"
          className="flex items-center"
        >
          {/* Canonical Sanocare lockup. Height locked to match the bar; */}
          {/* width auto via aspect ratio of the SVG. */}
          <Image
            src="/sanocare-lockup.svg"
            alt="Sanocare"
            width={120}
            height={28}
            priority
            className="h-7 w-auto lg:h-8"
          />
        </Link>
      </div>

      {/* Right cluster: member chip + avatar (both structural placeholders */}
      {/* until Step 07 wires the sheets/menus). */}
      <div className="flex items-center gap-2 lg:gap-3">
        <button
          type="button"
          onClick={onMemberChipClick}
          aria-label={`Viewing care for ${viewingFirstName}. Tap to switch.`}
          // T90 Step 08-fold-in 1: tap target enlarged from py-1.5 (32px
          // effective height) to py-2 (36px) — still snug but matches the
          // avatar's h-9 for iOS reliability. Founder UAT flagged the chip
          // tap as unreliable on mobile.
          className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <span className="max-w-[8rem] truncate">{viewingFirstName}</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-4 w-4 ${chevronDimmed ? "text-gray-300" : "text-gray-500"}`}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <button
          type="button"
          onClick={onAvatarClick}
          aria-label={`Account menu for ${customer.full_name ?? "your account"}`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent-coral text-sm font-semibold text-white hover:opacity-90"
        >
          {initials}
        </button>
      </div>
    </header>
  );
}

/**
 * Two-letter initials: first letter of first word + first letter of last
 * word. Single-word names use the first two letters. Falls back to "•"
 * for null full_name.
 */
function deriveInitials(fullName: string | null): string {
  if (!fullName) return "•";
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) {
    const w = parts[0];
    return (w.length >= 2 ? w.slice(0, 2) : w).toUpperCase();
  }
  const first = parts[0][0] ?? "";
  const last = parts[parts.length - 1][0] ?? "";
  const initials = `${first}${last}`.toUpperCase();
  return initials || "•";
}
