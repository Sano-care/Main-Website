"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";

/**
 * T90 Slice 2 Step 13 — Health-notes inline-edit row (Profile tab,
 * any viewing target — self OR family member).
 *
 * Three visual states per brief Surface 8:
 *   - empty:  "Add health notes →"   tap → textarea opens
 *   - filled: "{notes}" + "Edit →"   tap Edit → textarea opens with current value
 *   - editing: textarea + helper + Save/Cancel
 *
 * Saves to /api/pulse/profile/health-notes with target dispatch:
 *   self      → { target: 'self', ... }
 *   member    → { target: { kind: 'member', memberId }, ... }
 *
 * Re-syncs `value` from `initialNotes` when the viewing target
 * changes (parent rerenders with a different `targetKey` prop +
 * new initialNotes). Prevents the field from showing stale notes
 * from the previously-viewed member when the chrome chip switches.
 */

type Target = "self" | { kind: "member"; memberId: string };

interface Props {
  /** Current value from server. Null = no notes yet. */
  initialNotes: string | null;
  /** Self → 'self'. Member → { kind: 'member', memberId: <uuid> }. */
  target: Target;
  /**
   * Re-syncs internal state when the parent re-renders with a different
   * viewing target. Pass 'self' or member.id — when this prop changes
   * the component re-reads initialNotes.
   */
  targetKey: string;
}

const NOTES_MAX_LENGTH = 500;

export default function HealthNotesField({
  initialNotes,
  target,
  targetKey,
}: Props) {
  const [value, setValue] = useState<string | null>(initialNotes);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialNotes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when the viewing target switches (e.g., chrome chip switches
  // from Self to Mom — parent passes new initialNotes + new targetKey).
  useEffect(() => {
    setValue(initialNotes);
    setDraft(initialNotes ?? "");
    setEditing(false);
    setError(null);
    // Intentional: re-run only when the viewing target identity changes.
    // initialNotes is allowed to change without target change (e.g., the
    // server-side fetch resolves a moment later); in that case the
    // earlier useState seeds are still right because targetKey hasn't
    // moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  function startEdit() {
    setDraft(value ?? "");
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
    setDraft(value ?? "");
  }

  async function handleSave() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/pulse/profile/health-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          target,
          health_notes: draft,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        health_notes?: string | null;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error || "Could not save. Please try again.");
        return;
      }
      setValue(json.health_notes ?? null);
      setEditing(false);
    } catch (err) {
      console.error("[HealthNotesField] save failed", err);
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (editing) {
    const remaining = NOTES_MAX_LENGTH - draft.length;
    return (
      <div className="space-y-2">
        <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary">
          Health notes
        </label>
        <textarea
          autoFocus
          value={draft}
          maxLength={NOTES_MAX_LENGTH}
          rows={4}
          placeholder="Conditions, allergies, anything a doctor should know — your notes, your words."
          onChange={(e) => setDraft(e.target.value)}
          className="w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-text-main outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 placeholder:text-slate-400"
        />
        <p className="text-[11px] text-text-secondary">
          {remaining >= 0 ? `${remaining} characters left.` : ""}
        </p>
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
              Save notes
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
      className="flex w-full items-start justify-between gap-3 rounded-xl px-1 py-2 text-left hover:bg-slate-50"
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-wider text-text-secondary">
          Health notes
        </p>
        {value ? (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm font-medium text-text-main">
            {value}
          </p>
        ) : (
          <p className="mt-0.5 text-sm font-medium text-primary">
            Add health notes <span aria-hidden="true">→</span>
          </p>
        )}
      </div>
      {value ? (
        <span className="shrink-0 pt-0.5 text-sm font-medium text-primary">
          Edit <span aria-hidden="true">→</span>
        </span>
      ) : null}
    </button>
  );
}
