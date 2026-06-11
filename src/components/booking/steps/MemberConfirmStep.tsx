"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight, Loader2, MapPin } from "lucide-react";

import { Button } from "@/components/ui";
import { formatIST } from "@/lib/time/formatIST";
import { relationDisplayLabel } from "@/lib/family-members/relations";
import type { FamilyMember } from "@/lib/family-members/types";
import {
  useBookingStore,
  type PulseEntryMember,
} from "@/store/bookingStore";

/**
 * T90 Slice 2 Step 12 — Booking Step 0 (MemberConfirmStep, brief Surface 9).
 *
 * Renders as the first step of ServiceLedBookingModal / LabBasketWindow
 * when `bookingStore.entryPoint === 'pulse'`. Confirms WHO the booking
 * is for (self vs family member) and pre-fills the manual_address from
 * the patient's most recent prior booking.
 *
 * Two render variants:
 *   - { kind: 'self' }    → "Booking for yourself." (no chevron, no
 *                            Change link, no age/last-visit lines)
 *   - { kind: 'member' }  → "Booking for: [Mom ▼]" + relation line +
 *                            age line + last-visit line + Change link.
 *                            Tapping chevron OR Change opens an INLINE
 *                            dropdown picker (not the chrome-level
 *                            MemberSwitcherSheet — avoids the z-index
 *                            stacking dance against the modal).
 *
 * Mid-flow member switch with `addressTouched` triggers a confirmation
 * dialog ("Switch this booking to {newName}? The address will reset
 * to {newName}'s last visit location.") — keeps users from accidentally
 * blowing away typed input.
 *
 * Cross-folder hygiene: members list comes from /api/pulse/family-members,
 * NOT from the Pulse-side MemberViewingContext. Keeps this step in the
 * shared booking/steps/ folder without a backward dep on Pulse-app code.
 *
 * On Continue:
 *   - bookingStore.name        ← patient_name (member.name or customer's
 *                                 full_name for self — sourced from
 *                                 verifiedFullName, populated by Pulse
 *                                 OTP-verify response).
 *   - bookingStore.location    ← address field value
 *   - bookingStore.pulseEntryMember stays (downstream wherewhen/payment
 *                                 reads it for member_id on the insert).
 *   - onContinue() — modal navigates to the next step.
 */

interface Props {
  /** Modal navigates to its next step (wherewhen, identify, etc.). */
  onContinue: () => void;
}

interface PrefillResponse {
  manual_address: string | null;
  last_booking_at: string | null;
}

export function MemberConfirmStep({ onContinue }: Props) {
  const pulseEntryMember = useBookingStore((s) => s.pulseEntryMember);
  const setPulseEntryMember = useBookingStore((s) => s.setPulseEntryMember);
  const location = useBookingStore((s) => s.location);
  const setDetails = useBookingStore((s) => s.setDetails);
  const verifiedFullName = useBookingStore((s) => s.verifiedFullName);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);

  // addressTouched flips the first time the user edits the address
  // field. Resets when the user accepts a mid-flow member switch
  // (and the address is re-fetched fresh for the new member).
  const [addressTouched, setAddressTouched] = useState(false);

  // Mid-flow switch confirmation queue. Null = no pending switch.
  const [pendingSwitch, setPendingSwitch] = useState<PulseEntryMember | null>(
    null,
  );

  // Address pre-fill state — re-fetches every time pulseEntryMember changes.
  const [prefill, setPrefill] = useState<PrefillResponse | null>(null);
  const [prefillLoading, setPrefillLoading] = useState(false);

  // === Fetch family members once (for the inline picker). ============
  useEffect(() => {
    let cancelled = false;
    setMembersLoading(true);
    fetch("/api/pulse/family-members", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((data: { members?: FamilyMember[] }) => {
        if (cancelled) return;
        setMembers(Array.isArray(data.members) ? data.members : []);
        setMembersLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setMembersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // === Fetch address pre-fill whenever pulseEntryMember changes. ====
  // Skips when addressTouched (user has typed; don't clobber).
  useEffect(() => {
    if (!pulseEntryMember) return;
    if (addressTouched) return;

    const patientName =
      pulseEntryMember.kind === "member" ? pulseEntryMember.member.name : null;
    const url = patientName
      ? `/api/pulse/booking/address-prefill?patient_name=${encodeURIComponent(patientName)}`
      : "/api/pulse/booking/address-prefill";

    let cancelled = false;
    setPrefillLoading(true);
    fetch(url, { credentials: "include" })
      .then((r) =>
        r.ok ? r.json() : { manual_address: null, last_booking_at: null },
      )
      .then((data: PrefillResponse) => {
        if (cancelled) return;
        setPrefill(data);
        if (data.manual_address) {
          setDetails({ location: data.manual_address });
        }
        setPrefillLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPrefillLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pulseEntryMember, addressTouched, setDetails]);

  // === Derived display values ========================================
  const displayName = useMemo(() => {
    if (!pulseEntryMember) return "";
    if (pulseEntryMember.kind === "self") {
      return firstWord(verifiedFullName) ?? "Yourself";
    }
    return firstWord(pulseEntryMember.member.name) ?? pulseEntryMember.member.name;
  }, [pulseEntryMember, verifiedFullName]);

  const memberContext = useMemo(() => {
    if (!pulseEntryMember || pulseEntryMember.kind !== "member") return null;
    const m = pulseEntryMember.member;
    const relation = relationDisplayLabel(m.relation, m.relation_other);
    const age = computeAge(m.dob);
    return { relation, age };
  }, [pulseEntryMember]);

  const lastVisitDisplay = useMemo(() => {
    if (!prefill?.last_booking_at) return null;
    return formatIST(prefill.last_booking_at, "relativeShort");
  }, [prefill]);

  // === Picker handlers ==============================================
  const handleSelect = useCallback(
    (next: PulseEntryMember) => {
      setPickerOpen(false);
      // No-op if selecting current
      if (samePulseEntryMember(next, pulseEntryMember)) return;

      if (addressTouched) {
        // User has typed an address — confirm before clobbering
        setPendingSwitch(next);
      } else {
        // Silent switch — useEffect refetches address pre-fill
        applySwitch(next);
      }
    },
    [addressTouched, pulseEntryMember],
  );

  const applySwitch = useCallback(
    (next: PulseEntryMember) => {
      setPulseEntryMember(next);
      // Seed the patient_name on the store so downstream steps (and
      // the insert payload) have the right snapshot.
      const newName =
        next.kind === "member" ? next.member.name : (verifiedFullName ?? "");
      setDetails({ name: newName, location: "" });
      setAddressTouched(false);
    },
    [setPulseEntryMember, setDetails, verifiedFullName],
  );

  const confirmPendingSwitch = useCallback(() => {
    if (!pendingSwitch) return;
    applySwitch(pendingSwitch);
    setPendingSwitch(null);
  }, [pendingSwitch, applySwitch]);

  const cancelPendingSwitch = useCallback(() => {
    setPendingSwitch(null);
  }, []);

  // === Address field handler =======================================
  const handleAddressChange = useCallback(
    (value: string) => {
      setDetails({ location: value });
      setAddressTouched(true);
    },
    [setDetails],
  );

  // === Continue ====================================================
  const canContinue =
    Boolean(pulseEntryMember) && location.trim().length > 3 && !prefillLoading;

  const handleContinue = useCallback(() => {
    if (!canContinue || !pulseEntryMember) return;
    const patientName =
      pulseEntryMember.kind === "member"
        ? pulseEntryMember.member.name
        : (verifiedFullName ?? "");
    // Seed both name and location on the store (location is already
    // there from the address-prefill effect or the user's edits, but
    // make it explicit so downstream steps don't depend on field
    // ordering).
    setDetails({ name: patientName, location: location.trim() });
    onContinue();
  }, [canContinue, pulseEntryMember, verifiedFullName, location, setDetails, onContinue]);

  if (!pulseEntryMember) {
    // Shouldn't happen — the parent modal only mounts this step when
    // entryPoint === 'pulse' (which is always set alongside
    // pulseEntryMember). Defensive null-render avoids a confusing
    // crash if state is weird.
    return null;
  }

  return (
    <div className="space-y-5 p-5">
      {/* === Patient subject card ============================ */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        {pulseEntryMember.kind === "self" ? (
          <h2 className="text-base font-semibold text-text-main">
            Booking for yourself.
          </h2>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                className="flex items-center gap-1 text-base font-semibold text-text-main hover:text-primary"
              >
                <span>Booking for: {displayName}</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${pickerOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                className="text-sm font-medium text-primary hover:underline"
              >
                Change
              </button>
            </div>
            {memberContext ? (
              <p className="mt-1 text-sm text-text-secondary">
                {memberContext.relation}
                {memberContext.age !== null ? ` · Age ${memberContext.age}` : ""}
              </p>
            ) : null}
            {lastVisitDisplay ? (
              <p className="mt-0.5 text-xs text-text-secondary">
                Last visit {lastVisitDisplay}
              </p>
            ) : null}
          </>
        )}

        {/* Inline picker (family only) */}
        <AnimatePresence initial={false}>
          {pickerOpen && pulseEntryMember.kind === "member" ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <div className="mt-4 flex flex-col gap-1 border-t border-slate-100 pt-3">
                {/* "Yourself" row — always rendered. When the picker is */}
                {/* open, current target is necessarily a family member */}
                {/* (self mode hides the picker entirely), so selected */}
                {/* is always false here. */}
                <PickerRow
                  selected={false}
                  label={`${firstWord(verifiedFullName) ?? "You"} (you)`}
                  onClick={() => handleSelect({ kind: "self" })}
                />
                {membersLoading ? (
                  <div className="flex items-center gap-2 px-3 py-2 text-xs text-text-secondary">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading family
                    members…
                  </div>
                ) : (
                  members.map((m) => (
                    <PickerRow
                      key={m.id}
                      selected={
                        pulseEntryMember.kind === "member" &&
                        pulseEntryMember.member.id === m.id
                      }
                      label={firstWord(m.name) ?? m.name}
                      onClick={() =>
                        handleSelect({ kind: "member", member: m })
                      }
                    />
                  ))
                )}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </section>

      {/* === Address field ==================================== */}
      <section>
        <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary">
          Address
        </label>
        <div className="relative mt-1.5">
          <MapPin
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
            aria-hidden="true"
          />
          <textarea
            value={location}
            onChange={(e) => handleAddressChange(e.target.value)}
            placeholder={
              prefillLoading
                ? "Loading recent address…"
                : "Building, street, area, landmark"
            }
            rows={3}
            disabled={prefillLoading}
            className="w-full resize-none rounded-xl border border-slate-200 bg-white py-3 pl-9 pr-3 text-sm text-text-main outline-none placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:opacity-60"
          />
        </div>
        {prefill?.manual_address && !addressTouched ? (
          <p className="mt-1 text-[11px] text-text-secondary">
            Pre-filled from last visit — edit if needed.
          </p>
        ) : null}
      </section>

      {/* === Continue ========================================= */}
      <Button
        type="button"
        onClick={handleContinue}
        disabled={!canContinue}
        variant="primary"
        size="lg"
        className="w-full"
      >
        Continue
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>

      {/* === Mid-flow switch confirmation ===================== */}
      <AnimatePresence>
        {pendingSwitch ? (
          <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              role="alertdialog"
              aria-modal="true"
              className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <h3 className="text-base font-bold text-text-main">
                Switch this booking to{" "}
                {pendingSwitch.kind === "member"
                  ? firstWord(pendingSwitch.member.name)
                  : (firstWord(verifiedFullName) ?? "yourself")}
                ?
              </h3>
              <p className="mt-2 text-sm text-text-secondary">
                The address will reset to{" "}
                {pendingSwitch.kind === "member"
                  ? `${firstWord(pendingSwitch.member.name)}'s last visit location`
                  : "your last visit location"}
                .
              </p>
              <div className="mt-5 flex gap-3">
                <Button
                  type="button"
                  onClick={cancelPendingSwitch}
                  variant="outline"
                  size="md"
                  className="flex-1"
                >
                  Keep current
                </Button>
                <Button
                  type="button"
                  onClick={confirmPendingSwitch}
                  variant="primary"
                  size="md"
                  className="flex-1"
                >
                  Switch
                </Button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// ====== Helpers ======================================================

interface PickerRowProps {
  selected: boolean;
  label: string;
  onClick: () => void;
}

function PickerRow({ selected, label, onClick }: PickerRowProps) {
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
        {selected ? <span className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function firstWord(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] || null;
}

function computeAge(dob: string | null): number | null {
  if (!dob) return null;
  // dob is ISO date "YYYY-MM-DD"
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) {
    age--;
  }
  return age >= 0 && age < 130 ? age : null;
}

function samePulseEntryMember(
  a: PulseEntryMember,
  b: PulseEntryMember | null,
): boolean {
  if (!b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "self") return true;
  if (b.kind === "self") return false;
  return a.member.id === b.member.id;
}
