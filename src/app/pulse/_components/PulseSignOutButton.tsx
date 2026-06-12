"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";

/**
 * T90 Slice 2 Step 14 + 17 — DRY sign-out client component.
 *
 * Three visual variants:
 *   "primary"  — large pill (Account-settings page CTA, Step 14).
 *                Full-width-on-mobile button with icon.
 *   "ghost"    — compact text+icon for inline contexts. Reserved.
 *   "menu"     — full-width row with hover-bg + left-aligned LogOut
 *                icon. Used by PulseDrawer + PulseAvatarMenu sign-out
 *                paths (migrated in Step 17). Matches the rounded-lg
 *                px-3 py-2.5 row style both menus use for their
 *                other rows so the sign-out button is visually
 *                consistent with the rest of the menu.
 *
 * Sign-out flow (matches the pre-Step-17 inline pattern from Drawer +
 * AvatarMenu):
 *   POST /api/pulse/signout  → 204 + cleared cookie
 *   router.push('/pulse/login')
 *
 * Soft-fails on network error and still bounces to /pulse/login — the
 * login page's own getCurrentCustomer() check redirects to home if the
 * cookie is somehow still valid (it shouldn't be).
 */

interface Props {
  variant?: "primary" | "ghost" | "menu";
  /** Label override. Defaults to "Sign out". */
  label?: string;
}

export default function PulseSignOutButton({
  variant = "primary",
  label = "Sign out",
}: Props) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleClick() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/pulse/signout", { method: "POST" });
    } catch (err) {
      console.error("[PulseSignOutButton] sign-out failed", err);
    }
    router.push("/pulse/login");
  }

  if (variant === "ghost") {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={signingOut}
        className="inline-flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-text-main disabled:opacity-60"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        {signingOut ? "Signing out…" : label}
      </button>
    );
  }

  if (variant === "menu") {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={signingOut}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-60"
      >
        <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{signingOut ? "Signing out…" : label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={signingOut}
      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-6 py-3.5 text-sm font-semibold text-text-main shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60"
    >
      <LogOut className="h-4 w-4" aria-hidden="true" />
      {signingOut ? "Signing out…" : label}
    </button>
  );
}
