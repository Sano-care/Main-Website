"use client";

import { useState } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "framer-motion";

import { AddMemberForm } from "../(authed)/family-members/_components/AddMemberForm";
import { useCurrentCustomer } from "../_lib/PulseCustomerContext";
import { useViewingMember } from "../_lib/MemberViewingContext";

/**
 * T90 Pulse v1 Phase 1 — Member-switcher (Surface 3).
 *
 * Triggered by the AppBar member chip. Two render modes:
 *   - Mobile (<sm, 640px): full-width bottom sheet, slide-up + dimmed
 *     backdrop. 300ms ease-out — handled by framer-motion spring.
 *   - Desktop (≥sm): anchored top-right dropdown panel (fixed
 *     `top-20 right-4`) with no backdrop dimming (`bg-transparent`)
 *     so the page beneath stays readable. Tap-out still closes.
 *
 * Content (brief Surface 3, verbatim copy):
 *   Header:   "Who are you viewing?"
 *   Rows:     ● self: "{firstName} (you)" — current = filled radio
 *             ○ each member: "{firstName}"
 *   Footer:   + Add a family member
 *
 * Reuses the existing T64 AddMemberForm — no new add-member UI. On
 * save, we refetch members + close the sheet. We deliberately do NOT
 * auto-switch viewing to the new member — user can tap them in the
 * sheet's next open. (Open question for v1.1: auto-switch on add?)
 *
 * Self-only edge case (members.length === 0): the sheet still renders
 * with just the self row + the "+ Add" link below. The chip in the
 * AppBar dims its chevron in this case (handled in PulseAppBar).
 */

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function MemberSwitcherSheet({ open, onClose }: Props) {
  const customer = useCurrentCustomer();
  const { members, viewing, setViewingId, refetchMembers } = useViewingMember();
  const prefersReducedMotion = useReducedMotion();
  const [addOpen, setAddOpen] = useState(false);

  const selfFirstName = deriveFirstName(customer.full_name);
  const currentId = viewing.kind === "self" ? null : viewing.member.id;

  function handleSelect(memberId: string | null) {
    setViewingId(memberId);
    onClose();
  }

  function handleAddOpen() {
    setAddOpen(true);
  }

  async function handleAdded() {
    await refetchMembers();
    setAddOpen(false);
    onClose();
  }

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-40 flex items-end sm:items-start sm:justify-end sm:p-4 sm:pt-20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {/* Backdrop — dimmed on mobile, transparent on desktop. */}
            {/* Tap-out close in both modes. */}
            <button
              type="button"
              aria-label="Close member switcher"
              onClick={onClose}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm sm:bg-transparent sm:backdrop-blur-0"
            />

            {/* Sheet body */}
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Switch viewing member"
              className="relative w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:w-80 sm:max-w-sm sm:rounded-2xl sm:border sm:border-gray-200"
              initial={
                prefersReducedMotion
                  ? { opacity: 0 }
                  : { y: "100%", opacity: 0.6 }
              }
              animate={{ y: 0, opacity: 1 }}
              exit={
                prefersReducedMotion ? { opacity: 0 } : { y: "100%", opacity: 0 }
              }
              transition={
                prefersReducedMotion
                  ? { duration: 0.15 }
                  : { type: "spring", stiffness: 320, damping: 32 }
              }
            >
              <h2 className="text-sm font-bold text-gray-900">
                Who are you viewing?
              </h2>
              <div className="mt-4 flex flex-col gap-1">
                <MemberRadioRow
                  selected={currentId === null}
                  label={`${selfFirstName} (you)`}
                  onClick={() => handleSelect(null)}
                />
                {members.map((m) => (
                  <MemberRadioRow
                    key={m.id}
                    selected={currentId === m.id}
                    label={deriveFirstName(m.name)}
                    onClick={() => handleSelect(m.id)}
                  />
                ))}
              </div>
              <hr className="my-4 border-gray-200" />
              <button
                type="button"
                onClick={handleAddOpen}
                className="text-sm font-medium text-primary hover:underline"
              >
                + Add a family member
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* T64 AddMemberForm — reused verbatim. Mounts as its own modal */}
      {/* on top of the sheet. On save: refetch + close both. */}
      <AddMemberForm
        open={addOpen}
        editing={null}
        onClose={() => setAddOpen(false)}
        onSaved={handleAdded}
      />
    </>
  );
}

interface MemberRadioRowProps {
  selected: boolean;
  label: string;
  onClick: () => void;
}

function MemberRadioRow({ selected, label, onClick }: MemberRadioRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${
        selected
          ? "bg-blue-50 text-primary"
          : "text-gray-800 hover:bg-gray-50"
      }`}
    >
      <span
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
          selected ? "border-primary" : "border-gray-300"
        }`}
        aria-hidden="true"
      >
        {selected && (
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        )}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function deriveFirstName(name: string | null): string {
  if (!name) return "You";
  const trimmed = name.trim();
  if (!trimmed) return "You";
  const first = trimmed.split(/\s+/)[0];
  return first.length > 0 ? first : "You";
}
