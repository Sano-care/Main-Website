"use client";

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";

/**
 * T90 Slice 2 Step 13 — Email inline-edit row (Profile tab,
 * self-viewing only).
 *
 * Two visual states per brief Surface 8:
 *   - empty: "Add email →"   tap → input opens
 *   - filled: "{email}" + "Edit →"   tap Edit → input opens with current value
 *
 * Inline edit (no route nav). Save → POST /api/pulse/profile/email,
 * 200 → reflect new value + collapse back to read state, 400 →
 * inline error banner, network error → soft-fail toast text.
 */

interface Props {
  /** Current value from server. Null = no email yet ("Add email →" CTA). */
  initialEmail: string | null;
}

export default function EmailField({ initialEmail }: Props) {
  const [email, setEmail] = useState<string | null>(initialEmail);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialEmail ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setDraft(email ?? "");
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
    setDraft(email ?? "");
  }

  async function handleSave() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/pulse/profile/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: draft }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        email?: string | null;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error || "Could not save. Please try again.");
        return;
      }
      // Server returns the canonical normalised value (e.g. "" trimmed to null).
      setEmail(json.email ?? null);
      setEditing(false);
    } catch (err) {
      console.error("[EmailField] save failed", err);
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary">
          Email
        </label>
        <input
          type="email"
          autoFocus
          inputMode="email"
          value={draft}
          maxLength={254}
          placeholder="your@email.com"
          onChange={(e) => setDraft(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-text-main outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
        />
        {error ? (
          <p role="alert" className="text-xs text-rose-700">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={cancelEdit}
            disabled={submitting}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-text-secondary hover:bg-slate-50 disabled:opacity-60"
          >
            <span className="inline-flex items-center justify-center gap-1.5">
              <X className="h-4 w-4" aria-hidden="true" />
              Cancel
            </span>
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={submitting}
            className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-primary/20 hover:opacity-90 disabled:opacity-60"
          >
            <span className="inline-flex items-center justify-center gap-1.5">
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="h-4 w-4" aria-hidden="true" />
              )}
              Save email
            </span>
          </button>
        </div>
      </div>
    );
  }

  // Read state — empty vs filled.
  return (
    <button
      type="button"
      onClick={startEdit}
      className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-2 text-left hover:bg-slate-50"
    >
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wider text-text-secondary">
          Email
        </p>
        {email ? (
          <p className="mt-0.5 truncate text-sm font-semibold text-text-main">
            {email}
          </p>
        ) : (
          <p className="mt-0.5 text-sm font-medium text-primary">
            Add email <span aria-hidden="true">→</span>
          </p>
        )}
      </div>
      {email ? (
        <span className="text-sm font-medium text-primary">
          Edit <span aria-hidden="true">→</span>
        </span>
      ) : null}
    </button>
  );
}
