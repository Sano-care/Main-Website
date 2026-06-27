"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Plus, Loader2, X } from "lucide-react";

import type { FamilyMember } from "@/lib/family-members/types";
import { useScrollLock } from "@/hooks/useScrollLock";
import { pulseFetch } from "@/app/pulse/_lib/pulseClient";

// R2a — patient-write modal for Conditions + Allergies. JSON POST to
// /api/pulse/conditions or /api/pulse/allergies (the route forces source
// 'patient', IDOR-guards member_id, validates enums). Same modal scaffolding as
// UploadDocumentModal: mounts fresh each open (so useState initials are the
// reset — no re-seed effect), traps focus, closes on Esc + backdrop.

const STATUSES = ["active", "resolved", "inactive"] as const;
const SEVERITIES = ["unknown", "mild", "moderate", "severe"] as const;

const CONFIG = {
  conditions: {
    title: "Add a condition",
    endpoint: "/api/pulse/conditions",
    labelLabel: "Condition",
    labelPlaceholder: "e.g. Hypertension",
    hasSeverity: false,
  },
  allergies: {
    title: "Add an allergy",
    endpoint: "/api/pulse/allergies",
    labelLabel: "Allergy",
    labelPlaceholder: "e.g. Penicillin",
    hasSeverity: true,
  },
} as const;

export type AddRecordCategory = keyof typeof CONFIG;

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function AddRecordModal({
  open,
  category,
  onClose,
  members,
  defaultMemberId,
  onSaved,
}: {
  open: boolean;
  category: AddRecordCategory;
  onClose: () => void;
  members: FamilyMember[];
  defaultMemberId: string | null;
  onSaved: () => void;
}) {
  if (!open) return null;
  return (
    <RecordDialog
      category={category}
      onClose={onClose}
      members={members}
      defaultMemberId={defaultMemberId}
      onSaved={onSaved}
    />
  );
}

function RecordDialog({
  category,
  onClose,
  members,
  defaultMemberId,
  onSaved,
}: {
  category: AddRecordCategory;
  onClose: () => void;
  members: FamilyMember[];
  defaultMemberId: string | null;
  onSaved: () => void;
}) {
  const cfg = CONFIG[category];
  const prefersReducedMotion = useReducedMotion();
  useScrollLock(true);
  const dialogRef = useRef<HTMLDivElement>(null);

  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("active");
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("unknown");
  const [reaction, setReaction] = useState("");
  const [notedAt, setNotedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [memberId, setMemberId] = useState<string>(defaultMemberId ?? "self");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const node = dialogRef.current;
      if (e.key === "Escape" && !submitting) {
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
  }, [submitting, onClose]);

  const canSave = label.trim().length >= 1 && !submitting;

  async function handleSave() {
    if (!canSave) return;
    setSubmitting(true);
    setError(null);

    const payload: Record<string, unknown> = {
      label: label.trim(),
      status,
      noted_at: notedAt || null,
      notes: notes.trim() || null,
    };
    if (cfg.hasSeverity) {
      payload.severity = severity;
      payload.reaction = reaction.trim() || null;
    }
    if (memberId && memberId !== "self") payload.member_id = memberId;

    const { ok, data } = await pulseFetch<{ error?: string }>(cfg.endpoint, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!ok) {
      setError(data.error || "Couldn't save. Please try again.");
      setSubmitting(false);
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={submitting ? undefined : onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
      />

      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={cfg.title}
        tabIndex={-1}
        className="relative flex max-h-[92vh] w-full flex-col overflow-y-auto bg-white outline-none sm:max-w-md sm:rounded-3xl sm:shadow-2xl"
        initial={prefersReducedMotion ? false : { y: "100%", opacity: 0.6 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
          <h2 className="text-base font-bold text-text-main">{cfg.title}</h2>
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
          <label className="block">
            <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
              {cfg.labelLabel}
            </span>
            <input
              type="text"
              autoFocus
              value={label}
              maxLength={120}
              placeholder={cfg.labelPlaceholder}
              onChange={(e) => setLabel(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </label>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {cfg.hasSeverity ? (
              <label className="block">
                <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
                  Severity
                </span>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as (typeof SEVERITIES)[number])}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                >
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {titleCase(s)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="block">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
                Status
              </span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
                For
              </span>
              <select
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
              >
                <option value="self">Myself</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
                Since <span className="font-normal normal-case">(optional)</span>
              </span>
              <input
                type="date"
                value={notedAt}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setNotedAt(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </label>
          </div>

          {cfg.hasSeverity ? (
            <label className="mt-3 block">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
                Reaction <span className="font-normal normal-case">(optional)</span>
              </span>
              <input
                type="text"
                value={reaction}
                maxLength={200}
                placeholder="e.g. rash, swelling"
                onChange={(e) => setReaction(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </label>
          ) : null}

          <label className="mt-3 block">
            <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
              Notes <span className="font-normal normal-case">(optional)</span>
            </span>
            <textarea
              value={notes}
              maxLength={500}
              rows={2}
              placeholder="Anything your care team should know"
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </label>

          {error ? (
            <p className="mt-3 text-sm text-rose-600" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="sticky bottom-0 border-t border-slate-100 bg-white px-5 py-4">
          <button
            type="button"
            disabled={!canSave}
            onClick={handleSave}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                {cfg.title}
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
