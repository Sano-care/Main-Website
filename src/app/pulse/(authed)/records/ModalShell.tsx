"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";

import { useScrollLock } from "@/hooks/useScrollLock";

// R2b — shared dialog scaffolding for the records add-modals (the same pattern
// AddRecordModal / UploadDocumentModal inline): bottom-sheet on mobile, centred
// card on desktop, focus trapped, closes on Esc + backdrop (unless `busy`).
//
// Mount this only while open (the parent gates on `open`) so the consuming
// form's useState initials are its reset — no re-seed effect, no setState-in-
// effect. The effects here are addEventListener / .focus() only.

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function ModalShell({
  title,
  onClose,
  busy = false,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  /** When true, Esc + backdrop close are disabled (mid-submit). */
  busy?: boolean;
  children: ReactNode;
  footer: ReactNode;
}) {
  const prefersReducedMotion = useReducedMotion();
  useScrollLock(true);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const node = dialogRef.current;
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={busy ? undefined : onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
      />
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative flex max-h-[92vh] w-full flex-col overflow-y-auto bg-white outline-none sm:max-w-md sm:rounded-3xl sm:shadow-2xl"
        initial={prefersReducedMotion ? false : { y: "100%", opacity: 0.6 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
          <h2 className="text-base font-bold text-text-main">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 px-5 py-4">{children}</div>
        <div className="sticky bottom-0 border-t border-slate-100 bg-white px-5 py-4">{footer}</div>
      </motion.div>
    </div>
  );
}
