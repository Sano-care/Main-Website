"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";

/**
 * T90 Slice 2 Step 14 — DRY sign-out client component.
 *
 * Two visual variants today:
 *   "primary"  — large pill, used as the Account-settings page CTA
 *                (Step 14). Full-width-on-mobile button with icon.
 *   "ghost"    — text-only link with an icon, for inline contexts
 *                (e.g. embedded inside drawer-style menus in a
 *                follow-up). Reserved; not used yet.
 *
 * Sign-out flow (matches Drawer + AvatarMenu inline pattern from
 * Steps 05-07):
 *   POST /api/pulse/signout  → 204 + cleared cookie
 *   router.push('/pulse/login')
 *
 * Soft-fails on network error and still bounces to /pulse/login — the
 * login page's own getCurrentCustomer() check redirects to home if the
 * cookie is somehow still valid (it shouldn't be).
 *
 * Step 17 will migrate Drawer + AvatarMenu sign-out paths to consume
 * this component too — deferred per founder direction to keep Step 14's
 * commit scope tight.
 */

interface Props {
  variant?: "primary" | "ghost";
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
