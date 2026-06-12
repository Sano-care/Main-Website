"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { useViewingFirstName } from "../_lib/MemberViewingContext";
import PulseSignOutButton from "./PulseSignOutButton";

/**
 * T90 Pulse v1 Phase 1 — Hamburger drawer (Surface 4).
 *
 * Spec (brief Surface 4):
 *   - Mobile / tablet (<lg): slide-in from left, 80% viewport width,
 *     dimmed backdrop, closes on backdrop tap / Escape / item nav.
 *   - Desktop (≥lg, 1024px+): inline left rail, always visible
 *     (PulseChrome reserves `lg:ml-64` on the main content column).
 *
 * Items (brief Drawer items table, verbatim copy):
 *   1. Home
 *   2. Your records ▾ (expandable; sub-items are DIMMED with subtitle
 *      "Coming in next update" / "Coming soon" — no routing). Per founder
 *      direction: do NOT ship stub /pulse/records/* pages.
 *   3. Your profile — subtitle = current viewing member's first name
 *   4. Family members → /pulse/family-members
 *   5. Account settings → /pulse/account (page lands in Step 15)
 *   6. Help & support → /pulse/help (page lands in Step 16)
 *   — divider —
 *   7. Sign out (POST /api/pulse/signout → push /pulse/login)
 *   Footer: "Pulse v0.1 · sanocare.in" (tiny gray)
 *
 * "Current page highlight": the matching item gets a primary-blue accent
 * by matching `usePathname()` against each item's href.
 */

interface PulseDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PulseDrawer({ isOpen, onClose }: PulseDrawerProps) {
  const pathname = usePathname();

  // T90 Step 06: subtitle tracks the active viewing target — the entire
  // profile tab is scoped to whoever the user is currently viewing, so
  // the subtitle reflects that (was: account-holder first name in Step 05).
  const profileSubtitle = useViewingFirstName();

  // Close on Escape (mobile drawer only — the lg-rail is always open).
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // Lock body scroll when the mobile drawer is open. The lg-rail (which is
  // visible without `isOpen` being true on desktop) doesn't trigger this
  // because PulseChrome only sets isOpen via the hamburger button (mobile).
  useEffect(() => {
    if (!isOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [isOpen]);

  return (
    <>
      {/* Backdrop — mobile only. lg-rail mode never dims the page. */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity lg:hidden ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <aside
        aria-label="Pulse navigation"
        className={`fixed top-0 left-0 z-50 flex h-full w-[80vw] max-w-xs flex-col border-r border-gray-200 bg-white transition-transform duration-300 ease-out lg:sticky lg:top-0 lg:z-20 lg:h-screen lg:w-64 lg:max-w-none lg:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Drawer header: lockup + close (mobile only) */}
        <div className="flex h-14 items-center justify-between border-b border-gray-200 px-4 lg:h-16 lg:px-6">
          <Link
            href="/pulse"
            onClick={onClose}
            aria-label="Sanocare Pulse home"
            className="flex items-center"
          >
            <Image
              src="/sanocare-lockup.svg"
              alt="Sanocare"
              width={120}
              height={28}
              priority
              className="h-7 w-auto lg:h-8"
            />
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 lg:hidden"
          >
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
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
        </div>

        {/* Nav body */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="flex flex-col gap-1 text-sm">
            <DrawerItem
              icon="🏠"
              label="Home"
              href="/pulse"
              currentPath={pathname}
              onNavigate={onClose}
            />

            {/* Your records — expandable accordion. Sub-items are dimmed */}
            {/* with subtitle, NOT routes. */}
            <li>
              <details className="group rounded-lg">
                <summary className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-gray-800 hover:bg-gray-50">
                  <span className="flex items-center gap-3">
                    <span className="text-base" aria-hidden="true">
                      📋
                    </span>
                    <span className="font-medium">Your records</span>
                  </span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4 text-gray-500 transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </summary>
                <ul className="mt-1 flex flex-col gap-0.5 pl-11 pr-2">
                  <DimmedSubItem
                    label="Bookings"
                    subtitle="Coming in next update"
                  />
                  <DimmedSubItem
                    label="Prescriptions"
                    subtitle="Coming in next update"
                  />
                  <DimmedSubItem label="Documents" subtitle="Coming soon" />
                </ul>
              </details>
            </li>

            <DrawerItem
              icon="👤"
              label="Your profile"
              subtitle={profileSubtitle}
              href="/pulse/profile"
              currentPath={pathname}
              onNavigate={onClose}
            />
            <DrawerItem
              icon="👥"
              label="Family members"
              href="/pulse/family-members"
              currentPath={pathname}
              onNavigate={onClose}
            />
            <DrawerItem
              icon="⚙"
              label="Account settings"
              href="/pulse/account"
              currentPath={pathname}
              onNavigate={onClose}
            />
            <DrawerItem
              icon="❓"
              label="Help & support"
              href="/pulse/help"
              currentPath={pathname}
              onNavigate={onClose}
            />
          </ul>

          <hr className="my-3 border-gray-200" />

          <PulseSignOutButton variant="menu" />
        </nav>

        {/* Footer — tiny gray. v0.1 is what the brief specifies (Phase 1 */}
        {/* ships as v1, but the footer marker says v0.1 per the spec). */}
        <div className="border-t border-gray-200 px-4 py-3">
          <p className="text-[11px] leading-none text-gray-400">
            Pulse v1 · sanocare.in
          </p>
        </div>
      </aside>
    </>
  );
}

interface DrawerItemProps {
  icon: string;
  label: string;
  subtitle?: string;
  href: string;
  currentPath: string | null;
  onNavigate: () => void;
}

function DrawerItem({
  icon,
  label,
  subtitle,
  href,
  currentPath,
  onNavigate,
}: DrawerItemProps) {
  // Exact-match for /pulse (root); prefix-match for sub-routes so
  // /pulse/vitals/[id] highlights "Home" only when at /pulse exactly.
  const isActive =
    href === "/pulse" ? currentPath === "/pulse" : currentPath?.startsWith(href);

  return (
    <li>
      <Link
        href={href}
        onClick={onNavigate}
        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
          isActive
            ? "bg-blue-50 text-primary"
            : "text-gray-800 hover:bg-gray-50"
        }`}
      >
        <span className="text-base" aria-hidden="true">
          {icon}
        </span>
        <span className="flex flex-1 flex-col">
          <span className="font-medium leading-tight">{label}</span>
          {subtitle ? (
            <span className="text-xs leading-tight text-gray-500">
              {subtitle}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

/**
 * Dimmed sub-item under "Your records". Not a button, not a link — a
 * presentational row with subtitle. Per founder direction (Step 05 note 1):
 * dim + subtitle reads as "Coming soon" instantly without dead-end routing.
 */
function DimmedSubItem({
  label,
  subtitle,
}: {
  label: string;
  subtitle: string;
}) {
  return (
    <li
      aria-disabled="true"
      className="flex cursor-default flex-col rounded-lg px-3 py-2"
    >
      <span className="text-sm font-medium leading-tight text-gray-400">
        {label}
      </span>
      <span className="text-xs leading-tight text-gray-400">{subtitle}</span>
    </li>
  );
}

