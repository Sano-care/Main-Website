"use client";

import Link from "next/link";
import { useEffect } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "framer-motion";

import { useScrollLock } from "@/hooks/useScrollLock";

import { useCurrentCustomer } from "../_lib/PulseCustomerContext";
import PulseSignOutButton from "./PulseSignOutButton";

/**
 * T90 Pulse v1 Phase 1 — Avatar menu (Surface 5).
 *
 * Triggered by the AppBar avatar button. Two render modes:
 *   - Mobile (<sm): full-width bottom sheet (slide-up spring + dimmed
 *     backdrop) — same easing/positioning as MemberSwitcherSheet so
 *     the two surfaces feel like one family of sheets.
 *   - Desktop (≥sm): anchored top-right floating panel
 *     (fixed `top-20 right-4`) with transparent backdrop. Tap-out
 *     closes in both modes.
 *
 * Content (brief Surface 5, verbatim copy):
 *   Header:   {full_name}                   ← account holder
 *             +91 {phone}                   ← formatted
 *   ---
 *   Switch member        →                  ← opens MemberSwitcherSheet
 *   ---
 *   Account settings     →                  /pulse/account
 *   Help & support       →                  /pulse/help
 *   ---
 *   Sign out                                ← instant POST /signout
 *
 * Sign-out behaviour: instant (no confirmation dialog). Per founder
 * Step-07 scoping note: the brief's "unsaved state" check has nothing
 * to detect in Phase 1 (booking Step 0 = Step 12, profile inline edits
 * = Step 13; neither exists yet). Defer the confirmation scaffolding
 * to whichever later step introduces real unsaved state.
 *
 * Switch-member behaviour: clicking "Switch member" closes this menu
 * and asks PulseChrome to open MemberSwitcherSheet via the
 * `onSwitchMember` callback. No inline mini-picker — reuses the
 * existing sheet so there's one switcher surface (per founder note).
 *
 * Identity displayed = ACCOUNT HOLDER. The avatar represents the
 * account, not the viewing target. (Step-06 PulseAppBar already
 * separates these — chip = viewing, avatar = account holder.)
 */

interface Props {
  open: boolean;
  onClose: () => void;
  onSwitchMember: () => void;
}

export default function PulseAvatarMenu({
  open,
  onClose,
  onSwitchMember,
}: Props) {
  const customer = useCurrentCustomer();
  const prefersReducedMotion = useReducedMotion();
  useScrollLock(open);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  function handleSwitchMember() {
    onClose(); // close avatar menu first
    onSwitchMember(); // delegate sheet open to PulseChrome
  }

  const displayName = customer.full_name?.trim() || "Your account";
  const phoneDisplay = formatIndianPhone(customer.phone);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 flex items-end sm:items-start sm:justify-end sm:p-4 sm:pt-20"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Backdrop — dimmed on mobile, transparent on desktop. */}
          {/* Tap-out close in both modes. */}
          <button
            type="button"
            aria-label="Close account menu"
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm sm:bg-transparent sm:backdrop-blur-0"
          />

          <motion.div
            role="menu"
            aria-label="Account menu"
            className="relative w-full rounded-t-3xl bg-white p-4 shadow-2xl sm:w-72 sm:max-w-sm sm:rounded-2xl sm:border sm:border-gray-200"
            initial={
              prefersReducedMotion
                ? { opacity: 0 }
                : { y: "100%", opacity: 0.6 }
            }
            animate={{ y: 0, opacity: 1 }}
            exit={
              prefersReducedMotion
                ? { opacity: 0 }
                : { y: "100%", opacity: 0 }
            }
            transition={
              prefersReducedMotion
                ? { duration: 0.15 }
                : { type: "spring", stiffness: 320, damping: 32 }
            }
          >
            {/* Identity header — account holder, not viewing target. */}
            <div className="px-3 pb-3">
              <p className="truncate text-sm font-semibold text-gray-900">
                {displayName}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">{phoneDisplay}</p>
            </div>

            <hr className="border-gray-200" />

            <MenuButtonRow label="Switch member" onClick={handleSwitchMember} />

            <hr className="border-gray-200" />

            <MenuLinkRow
              label="Account settings"
              href="/pulse/account"
              onNavigate={onClose}
            />
            <MenuLinkRow
              label="Help & support"
              href="/pulse/help"
              onNavigate={onClose}
            />

            <hr className="border-gray-200" />

            {/* Sign out — instant, no confirmation (per Step-07 scoping). */}
            <div className="mt-1">
              <PulseSignOutButton variant="menu" />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface MenuButtonRowProps {
  label: string;
  onClick: () => void;
}

function MenuButtonRow({ label, onClick }: MenuButtonRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium text-gray-800 hover:bg-gray-50"
    >
      <span>{label}</span>
      <span className="text-gray-400" aria-hidden="true">
        →
      </span>
    </button>
  );
}

interface MenuLinkRowProps {
  label: string;
  href: string;
  onNavigate: () => void;
}

function MenuLinkRow({ label, href, onNavigate }: MenuLinkRowProps) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
    >
      <span>{label}</span>
      <span className="text-gray-400" aria-hidden="true">
        →
      </span>
    </Link>
  );
}

/**
 * E.164 +91XXXXXXXXXX → "+91 XXXXXXXXXX" display format.
 * Brief Surface 5 shows the phone with a space after the +91 country
 * code and no further chunking (e.g., "+91 9711977782"). Anything that
 * doesn't fit the +91-12-digit shape returns verbatim — defensive
 * fallback for non-Indian / mis-stored numbers, though M013 + the
 * normaliseIndianPhone helper already gate to this shape at write time.
 */
function formatIndianPhone(phone: string): string {
  const digits = phone.replace(/^\+/, "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+91 ${digits.slice(2)}`;
  }
  return phone;
}
