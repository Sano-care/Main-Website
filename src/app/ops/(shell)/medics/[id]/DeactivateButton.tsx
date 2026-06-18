"use client";

import { useState, useTransition } from "react";
import { deactivateMedicAction } from "./actions";

interface DeactivateButtonProps {
  medicId: string;
  medicName: string;
}

export function DeactivateButton({ medicId, medicName }: DeactivateButtonProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const confirm = () => {
    setErr(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("id", medicId);
        await deactivateMedicAction(fd);
        setOpen(false);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to deactivate.");
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-red-600 hover:text-red-700 hover:underline font-medium"
      >
        Deactivate medic
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => !pending && setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl p-6"
          >
            <h2 className="text-lg font-semibold text-slate-900">
              Deactivate {medicName}?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              They&apos;ll no longer be able to sign in via the Android app or
              receive new booking assignments. Existing assignments stay; you
              can re-activate any time by ticking <span className="font-mono">Active</span> and saving.
            </p>
            {err && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {err}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={pending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {pending ? "Deactivating…" : "Deactivate"}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
