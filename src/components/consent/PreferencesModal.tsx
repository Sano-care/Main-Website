"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";

import type { ConsentState } from "./consentState";

interface PreferencesModalProps {
  open: boolean;
  /** Existing consent (if any) — preselects the toggles. */
  current: ConsentState | null;
  onCancel: () => void;
  onSave: (next: { analytics: boolean; marketing: boolean }) => void;
}

export function PreferencesModal({
  open,
  current,
  onCancel,
  onSave,
}: PreferencesModalProps) {
  const [analytics, setAnalytics] = useState(current?.analytics ?? false);
  const [marketing, setMarketing] = useState(current?.marketing ?? false);

  // Keep toggle state in sync if the modal is reopened with a different
  // current value (e.g., user re-opens after a previous Save).
  useEffect(() => {
    if (open) {
      setAnalytics(current?.analytics ?? false);
      setMarketing(current?.marketing ?? false);
    }
  }, [open, current]);

  // Close on Escape key.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sano-consent-prefs-title"
      className="fixed inset-0 z-[101] flex items-end justify-center sm:items-center bg-slate-900/50 backdrop-blur-sm px-4 py-6"
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-slate-100">
          <h2
            id="sano-consent-prefs-title"
            className="text-lg font-semibold text-slate-900"
          >
            Cookie preferences
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Choose which kinds of cookies Sanocare can use on this device.
          </p>
        </div>

        <div className="px-6 py-4 space-y-4">
          <ToggleRow
            title="Necessary"
            description="Needed for booking, login, and payment to work."
            locked
            checked
          />
          <ToggleRow
            title="Analytics"
            description="Helps us understand which parts of Sanocare get used, so we can improve the service."
            checked={analytics}
            onChange={setAnalytics}
          />
          <ToggleRow
            title="Marketing"
            description="Lets us show you Sanocare ads on other sites you visit."
            checked={marketing}
            onChange={setMarketing}
          />
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave({ analytics, marketing })}
            className="px-4 py-2 text-sm font-medium bg-sky-600 hover:bg-sky-700 text-white rounded-lg"
          >
            Save preferences
          </button>
        </div>
      </div>
    </div>
  );
}

interface ToggleRowProps {
  title: string;
  description: string;
  checked: boolean;
  locked?: boolean;
  onChange?: (next: boolean) => void;
}

function ToggleRow({
  title,
  description,
  checked,
  locked = false,
  onChange,
}: ToggleRowProps) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        onClick={() => !locked && onChange?.(!checked)}
        disabled={locked}
        aria-pressed={checked}
        aria-label={`${title}: ${checked ? "on" : "off"}${locked ? ", always on" : ""}`}
        className={
          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors mt-0.5 " +
          (checked ? "bg-sky-600" : "bg-slate-200") +
          (locked ? " cursor-not-allowed opacity-80" : "")
        }
      >
        <span
          aria-hidden="true"
          className={
            "inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform " +
            (checked ? "translate-x-5" : "translate-x-0")
          }
        />
      </button>
      <div className="flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-slate-900">{title}</span>
          {locked && (
            <>
              <Lock className="w-3 h-3 text-slate-400" aria-hidden="true" />
              <span className="text-[11px] text-slate-500">always on</span>
            </>
          )}
        </div>
        <p className="text-xs text-slate-600 mt-0.5">{description}</p>
      </div>
    </div>
  );
}
