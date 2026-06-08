"use client";

// /pulse/family-members — client surface.
//
// Owns: the live list, add/edit/delete handlers, and the AddMemberForm
// modal. Reads the initial list from the server page, then refetches on
// any mutation so the UI stays in sync without optimistic plumbing.

import { useCallback, useMemo, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Plus, Users, AlertCircle } from "lucide-react";

import type { FamilyMember } from "@/lib/family-members/types";
import { pulseFetch } from "../_lib/pulseClient";
import { MemberCard } from "./_components/MemberCard";
import { AddMemberForm } from "./_components/AddMemberForm";

const MAX_MEMBERS = 8;

interface Props {
  initial: FamilyMember[];
}

export function FamilyMembersSurface({ initial }: Props) {
  const [members, setMembers] = useState<FamilyMember[]>(initial);
  const [formMode, setFormMode] = useState<
    { kind: "closed" } | { kind: "add" } | { kind: "edit"; member: FamilyMember }
  >({ kind: "closed" });
  const [pendingDelete, setPendingDelete] = useState<FamilyMember | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const atCap = members.length >= MAX_MEMBERS;

  const openAdd = useCallback(() => {
    if (atCap) {
      setError(
        `You've added the maximum of ${MAX_MEMBERS} family members. Delete one to add another.`,
      );
      return;
    }
    setError(null);
    setFormMode({ kind: "add" });
  }, [atCap]);

  const openEdit = useCallback((member: FamilyMember) => {
    setError(null);
    setFormMode({ kind: "edit", member });
  }, []);

  const handleSaved = useCallback((saved: FamilyMember) => {
    setMembers((prev) => {
      const idx = prev.findIndex((m) => m.id === saved.id);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
    setFormMode({ kind: "closed" });
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    setError(null);
    const { ok, data } = await pulseFetch<{ error?: string }>(
      `/api/pulse/family-members/${pendingDelete.id}`,
      { method: "DELETE" },
    );
    if (!ok) {
      setError(data?.error || "Could not delete. Please try again.");
      setDeleting(false);
      return;
    }
    setMembers((prev) => prev.filter((m) => m.id !== pendingDelete.id));
    setPendingDelete(null);
    setDeleting(false);
  }, [pendingDelete, deleting]);

  const sorted = useMemo(
    () =>
      members
        .slice()
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        ),
    [members],
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-4">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {sorted.length === 0 ? (
          <EmptyState onAdd={openAdd} />
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs text-text-secondary">
                {sorted.length} of {MAX_MEMBERS} family members
              </p>
            </div>
            <div className="space-y-2">
              {sorted.map((m) => (
                <MemberCard
                  key={m.id}
                  member={m}
                  onEdit={() => openEdit(m)}
                  onDelete={() => setPendingDelete(m)}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {/* Floating + Add CTA, hidden when at cap so the patient gets a clear
          "delete one to add another" UX instead of a click that errors. */}
      {!atCap && sorted.length > 0 && (
        <button
          type="button"
          onClick={openAdd}
          className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-coral text-white shadow-lg shadow-coral/40 transition-transform active:scale-95"
          aria-label="Add a family member"
        >
          <Plus className="h-6 w-6" />
        </button>
      )}

      {formMode.kind !== "closed" && (
        <AddMemberForm
          open
          editing={formMode.kind === "edit" ? formMode.member : null}
          onClose={() => setFormMode({ kind: "closed" })}
          onSaved={handleSaved}
        />
      )}

      <DeleteConfirmDialog
        member={pendingDelete}
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <section className="mt-10 rounded-3xl bg-white p-8 text-center shadow-md">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-50 text-primary">
        <Users className="h-7 w-7" />
      </div>
      <h2 className="text-base font-bold text-text-main">
        Add family members to book on their behalf
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        Track each person you book Sanocare visits for — a parent, spouse,
        child. You can manage up to 8 members.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-coral px-5 py-3 text-sm font-bold text-white shadow-lg shadow-coral/30 active:scale-95"
      >
        <Plus className="h-4 w-4" />
        Add first member
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation
// ---------------------------------------------------------------------------

function DeleteConfirmDialog({
  member,
  busy,
  onCancel,
  onConfirm,
}: {
  member: FamilyMember | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {member && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="Cancel delete"
            onClick={busy ? undefined : onCancel}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-label={`Delete ${member.name}?`}
            className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
            initial={
              prefersReducedMotion ? false : { opacity: 0, scale: 0.95 }
            }
            animate={{ opacity: 1, scale: 1 }}
            exit={
              prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }
            }
          >
            <h3 className="text-base font-bold text-text-main">
              Delete {member.name} from family?
            </h3>
            <p className="mt-2 text-sm text-text-secondary">
              Past bookings stay in your history.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="flex-1 rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-text-main hover:bg-slate-200 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy}
                className="flex-1 rounded-xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
              >
                {busy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
