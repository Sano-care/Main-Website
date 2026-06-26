"use client";

// Modal/sheet to add a new family member or edit an existing one. Same
// component for both flows; `editing` prop drives initial values, submit
// label, and which API verb runs.
//
// Mirrors the AddVitalSheet pattern (full-screen on mobile, centred card
// on desktop, AnimatePresence, prefers-reduced-motion) plus a body-scroll
// lock via useScrollLock — modal stays above a frozen page on iOS.
//
// Critical CHECK constraint coupling on `relation` / `relation_other`:
// when the user selects 'other', we reveal the description input and
// require it. When they switch back to a fixed relation, we drop the
// description so the API sends null (otherwise the DB CHECK trips).

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X, Loader2, Check, AlertCircle } from "lucide-react";

import type {
  FamilyMember,
  Gender,
  Relation,
} from "@/lib/family-members/types";
import {
  ALL_GENDERS,
  ALL_RELATIONS,
} from "@/lib/family-members/types";
import { buildFamilyMemberPayload } from "@/lib/family-members/payload";
import { RELATION_LABELS } from "@/lib/family-members/relations";
import { pulseFetch } from "../../../_lib/pulseClient";
import { useScrollLock } from "@/hooks/useScrollLock";

interface Props {
  open: boolean;
  /** When non-null, the form prefills + saves via PATCH. Else POST. */
  editing: FamilyMember | null;
  onClose: () => void;
  onSaved: (member: FamilyMember) => void;
}

const GENDER_LABELS: Record<Gender, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
  "prefer-not-to-say": "Prefer not to say",
};

export function AddMemberForm({ open, editing, onClose, onSaved }: Props) {
  const prefersReducedMotion = useReducedMotion();
  useScrollLock(open);

  const isEdit = editing != null;

  const [name, setName] = useState("");
  const [relation, setRelation] = useState<Relation>("father");
  const [relationOther, setRelationOther] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form whenever the sheet opens. The deps are intentionally
  // limited to `open` + `editing` so a parent rerender doesn't blow away
  // in-progress typing.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setRelation(editing.relation);
      setRelationOther(editing.relation_other ?? "");
      setDob(editing.dob ?? "");
      setGender(editing.gender ?? "");
      setNotes(editing.notes ?? "");
    } else {
      setName("");
      setRelation("father");
      setRelationOther("");
      setDob("");
      setGender("");
      setNotes("");
    }
    setError(null);
    setSaving(false);
  }, [open, editing]);

  const canSave = useMemo(() => {
    if (saving) return false;
    if (name.trim().length < 2) return false;
    if (relation === "other" && relationOther.trim().length === 0) return false;
    return true;
  }, [name, relation, relationOther, saving]);

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    // Enum contract (relation as exact enum, relation_other null unless
    // 'other', gender enum-or-null) lives in buildFamilyMemberPayload so it's
    // unit-tested. The validator + DB CHECK reject a non-null relation_other
    // on a non-'other' relation, so the null discipline is load-bearing.
    const payload = buildFamilyMemberPayload({
      name,
      relation,
      relationOther,
      dob,
      gender,
      notes,
    });

    const url = editing
      ? `/api/pulse/family-members/${editing.id}`
      : "/api/pulse/family-members";
    const method = editing ? "PATCH" : "POST";

    const { ok, data } = await pulseFetch<{
      member?: FamilyMember;
      error?: string;
    }>(url, { method, body: JSON.stringify(payload) });

    if (!ok || !data.member) {
      setError(data.error || "Could not save. Please try again.");
      setSaving(false);
      return;
    }

    onSaved(data.member);
    // Parent closes the sheet on save; we don't unmount ourselves here.
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={saving ? undefined : onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={isEdit ? "Edit family member" : "Add family member"}
            className="relative flex h-full w-full flex-col overflow-y-auto bg-white sm:h-auto sm:max-h-[90vh] sm:max-w-md sm:rounded-3xl sm:shadow-2xl"
            initial={
              prefersReducedMotion ? false : { y: "100%", opacity: 0.6 }
            }
            animate={{ y: 0, opacity: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
              <h2 className="text-base font-bold text-text-main">
                {isEdit ? "Edit family member" : "Add family member"}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 px-5 py-4">
              {/* Name */}
              <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary">
                Name
              </label>
              <input
                type="text"
                autoFocus={!isEdit}
                placeholder="e.g. Anjali Sharma"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-text-main outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
              />

              {/* Relation */}
              <label className="mt-5 block text-xs font-bold uppercase tracking-wider text-text-secondary">
                Relation
              </label>
              <select
                value={relation}
                onChange={(e) => setRelation(e.target.value as Relation)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-text-main outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
              >
                {ALL_RELATIONS.map((r) => (
                  <option key={r} value={r}>
                    {RELATION_LABELS[r]}
                  </option>
                ))}
              </select>

              {/* Relation 'other' free-text */}
              {relation === "other" && (
                <div className="mt-3">
                  <input
                    type="text"
                    placeholder="e.g. Father-in-law, Aunt"
                    value={relationOther}
                    maxLength={40}
                    onChange={(e) => setRelationOther(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-text-main outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
                  />
                  <p className="mt-1 text-[11px] text-text-secondary">
                    Required when relation is "Other".
                  </p>
                </div>
              )}

              {/* DOB */}
              <label className="mt-5 block text-xs font-bold uppercase tracking-wider text-text-secondary">
                Date of birth{" "}
                <span className="font-normal normal-case">(optional)</span>
              </label>
              <input
                type="date"
                value={dob}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDob(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-text-main outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
              />

              {/* Gender */}
              <label className="mt-5 block text-xs font-bold uppercase tracking-wider text-text-secondary">
                Gender{" "}
                <span className="font-normal normal-case">(optional)</span>
              </label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value as Gender | "")}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-text-main outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
              >
                <option value="">—</option>
                {ALL_GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {GENDER_LABELS[g]}
                  </option>
                ))}
              </select>

              {/* Notes */}
              <label className="mt-5 block text-xs font-bold uppercase tracking-wider text-text-secondary">
                Notes{" "}
                <span className="font-normal normal-case">(optional)</span>
              </label>
              <textarea
                placeholder="e.g. diabetic, on metformin"
                value={notes}
                maxLength={500}
                rows={3}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1.5 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-text-main outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 placeholder:text-slate-400"
              />

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
                  <AlertCircle
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 border-t border-slate-100 bg-white px-5 py-4">
              <button
                type="button"
                disabled={!canSave}
                onClick={handleSave}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent-coral px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-accent-coral/30 hover:bg-accent-coral-dark disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    {isEdit ? "Save changes" : "Add to family"}
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
