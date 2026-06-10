"use client";

import Image from "next/image";
import Link from "next/link";

import { useCurrentCustomer } from "../_lib/PulseCustomerContext";

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
 *   - Member chip: button-shaped, displays the current viewing member's
 *     first name (Phase 1 = always self). Tap is a structural placeholder
 *     until Step 07 wires <MemberSwitcherSheet />.
 *   - Avatar: 36px circle with first/last-initial. Tap is a structural
 *     placeholder until Step 07 wires <PulseAvatarMenu />.
 *
 * Hamburger is `lg:hidden` because on desktop ≥1024px the drawer becomes
 * an inline left rail (always visible) — no toggle needed. PulseChrome
 * passes onMenuClick which only fires on the mobile/tablet variant.
 *
 * Auth context: this is a client component nested under
 * <PulseCustomerProvider /> (from PulseChrome). useCurrentCustomer() is
 * safe here — PulseChrome only mounts the AppBar when a customer exists,
 * so the throw-on-null path never triggers on the login surface.
 */

interface PulseAppBarProps {
  onMenuClick: () => void;
}

export default function PulseAppBar({ onMenuClick }: PulseAppBarProps) {
  const customer = useCurrentCustomer();
  const firstName = deriveFirstName(customer.full_name);
  const initials = deriveInitials(customer.full_name);

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
          onClick={handleMemberChipClick}
          aria-label={`Viewing care for ${firstName}. Member switcher coming next.`}
          className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <span className="max-w-[8rem] truncate">{firstName}</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4 text-gray-500"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <button
          type="button"
          onClick={handleAvatarClick}
          aria-label={`Account menu for ${customer.full_name ?? "your account"}. Coming next.`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent-coral text-sm font-semibold text-white hover:opacity-90"
        >
          {initials}
        </button>
      </div>
    </header>
  );
}

// Step-07 placeholders. Console-warn so a tap during dev is visible without
// throwing. The handlers are non-throwing no-ops in prod (console.warn is
// harmless). Step 07 replaces these with sheet/menu open calls.
function handleMemberChipClick() {
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      "[PulseAppBar] member chip — MemberSwitcherSheet wires in Step 07",
    );
  }
}

function handleAvatarClick() {
  if (process.env.NODE_ENV !== "production") {
    console.warn("[PulseAppBar] avatar — PulseAvatarMenu wires in Step 07");
  }
}

/**
 * First word of full_name (e.g., "Shashwat Arora" → "Shashwat").
 * Falls back to "You" when full_name is null — the onboarding flow
 * (Step 09) captures the name on welcome, so this fallback only
 * surfaces for the edge case of a pre-name-capture session reaching
 * an authenticated page.
 */
function deriveFirstName(fullName: string | null): string {
  if (!fullName) return "You";
  const trimmed = fullName.trim();
  if (!trimmed) return "You";
  const first = trimmed.split(/\s+/)[0];
  return first.length > 0 ? first : "You";
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
