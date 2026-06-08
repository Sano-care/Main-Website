"use client";

// Profile / sign-out menu for the Pulse surfaces.
//
// Two triggers, one dropdown:
//   - variant="chip": the home greeting's "Viewing: <name> (you) ▾" context
//     chip (on the blue greeting band).
//   - variant="icon": a circular profile button in the interior page headers
//     (vitals / medications), mirroring the back button on the left.
//
// Tapping either opens a small dropdown whose only item (for now) is "Sign out"
// → POST /api/pulse/signout (clears the verify cookie) → hard-navigate to
// /pulse/login. T64 will add family-member switching as additional items here.
//
// Closes on outside-click and Escape. Honors prefers-reduced-motion: the panel
// appears/disappears with no transform/opacity animation.

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronDown, UserRound, LogOut, Loader2 } from "lucide-react";

import { useCurrentCustomer } from "../_lib/PulseCustomerContext";

export function ProfileMenu({ variant }: { variant: "chip" | "icon" }) {
  const customer = useCurrentCustomer();
  const firstName = customer.full_name?.trim().split(/\s+/)[0] ?? "there";

  const prefersReducedMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside-click + Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/pulse/signout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Best-effort: navigate to login regardless — the server re-gates there.
    }
    window.location.href = "/pulse/login";
  }

  return (
    <div ref={rootRef} className="relative">
      {variant === "chip" ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/25"
        >
          <span>Viewing: {firstName} (you)</span>
          <ChevronDown
            className={
              "h-3.5 w-3.5 transition-transform " + (open ? "rotate-180" : "")
            }
            aria-hidden="true"
          />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Account menu"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
        >
          <UserRound className="h-5 w-5" />
        </button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Account"
            className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
            initial={prefersReducedMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={
              prefersReducedMotion ? { duration: 0 } : { duration: 0.15 }
            }
          >
            <div className="border-b border-slate-100 px-4 py-2.5">
              <div className="text-xs text-slate-400">Signed in as</div>
              <div className="truncate text-sm font-semibold text-text-main">
                {customer.full_name ?? customer.phone}
              </div>
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              disabled={signingOut}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-60"
            >
              {signingOut ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <LogOut className="h-4 w-4" aria-hidden="true" />
              )}
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
