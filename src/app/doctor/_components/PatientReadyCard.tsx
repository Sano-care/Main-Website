"use client";

/**
 * Sanocare-native admit gate (Task #43) — the doctor-side surface.
 *
 * Renders above the existing DoctorWaitingQueue when a patient has
 * joined-but-not-admitted: consultation_participants.joined_at IS NOT
 * NULL AND consultation_sessions.doctor_admitted_at IS NULL. The card
 * vanishes (parent stops rendering it) once admittedAt flips non-null.
 *
 * What the card shows
 * ---------------------------------------------------------------------
 *  - Patient name + age + sex + customer_code
 *  - Booking code (SAN-B-NNNNN)
 *  - Live wait counter (mm:ss) ticking from joined_at, updated every
 *    second via a single setInterval
 *  - Presenting complaint pulled from bookings.specific_ailment
 *  - Previous-consult summary (count: "None" / "N previous")
 *  - Big primary "Admit Patient" button
 *
 * Realtime / polling
 * ---------------------------------------------------------------------
 * The card uses the shared useSessionAdmitState hook, which:
 *  - attempts a postgres_changes sub on the session row + the
 *    participant row (best-effort; likely RLS-rejected today)
 *  - polls /api/doctor/admit-state/[session_id] every 5s as the
 *    guaranteed-correct path
 *
 * The card hides itself the instant `admittedAt` flips non-null —
 * either because THIS doctor's click landed, or because another tab
 * already admitted, or because the SQL no-op caught a duplicate
 * write. In all three cases the parent's render of this card is
 * superfluous on the next render; we just hide locally too.
 *
 * Admit action
 * ---------------------------------------------------------------------
 * POSTs { session_id } to /api/doctor/admit-patient. Optimistic UX:
 * disable the button immediately on click, hide the card on success
 * (the parent will stop rendering it next pass, but we want the
 * instant feedback). On error, surface the message + re-enable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, Loader2, User, Clock } from "lucide-react";
import { useSessionAdmitState } from "@/lib/realtime/useSessionAdmitState";

export type PatientReadyCardProps = {
  /** consultation_sessions.id */
  sessionId: string;
  /** SSR-loaded value of consultation_participants.joined_at for the
   *  patient row. Drives the initial wait counter. Realtime hook may
   *  update this if it changes (rare — set-once column). */
  initialJoinedAt: string | null;
  /** SSR-loaded value of consultation_sessions.doctor_admitted_at.
   *  Will normally be null (otherwise the parent wouldn't render the
   *  card). Realtime hook flips this when admit fires. */
  initialAdmittedAt: string | null;
  /** customers.full_name */
  patientName: string | null;
  /** customers.customer_code (SAN-C-NNNNN) */
  customerCode: string | null;
  /** customers.date_of_birth — we derive age on the client. */
  dateOfBirth: string | null;
  /** customers.gender — M / F / O / U or null */
  gender: string | null;
  /** bookings.booking_code (SAN-B-NNNNN) */
  bookingCode: string | null;
  /** bookings.specific_ailment — the presenting complaint */
  presentingComplaint: string | null;
  /** Count of sent/superseded prescriptions on prior bookings for
   *  this patient. 0 → "None"; N → "N previous". */
  priorRxCount: number;
};

function calcAgeYears(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

function fmtSex(g: string | null): string | null {
  if (!g) return null;
  const u = g.toUpperCase();
  if (u === "M") return "M";
  if (u === "F") return "F";
  if (u === "O") return "Other";
  if (u === "U") return null; // "Unspecified" — don't bother rendering
  return g;
}

function fmtWait(ms: number): string {
  if (ms < 0) ms = 0;
  const secs = Math.floor(ms / 1000);
  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function PatientReadyCard({
  sessionId,
  initialJoinedAt,
  initialAdmittedAt,
  patientName,
  customerCode,
  dateOfBirth,
  gender,
  bookingCode,
  presentingComplaint,
  priorRxCount,
}: PatientReadyCardProps) {
  // Live realtime/polling state. fetchState hits the doctor-side polling
  // endpoint; memoised so we don't reinstall the polling interval on
  // every render.
  const fetchState = useCallback(async () => {
    const res = await fetch(`/api/doctor/admit-state/${sessionId}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      // Treat as no-change; hook swallows polling errors anyway.
      throw new Error(`admit-state ${res.status}`);
    }
    const data = (await res.json()) as {
      joinedAt: string | null;
      admittedAt: string | null;
    };
    return data;
  }, [sessionId]);

  const { joinedAt, admittedAt } = useSessionAdmitState({
    sessionId,
    initial: {
      joinedAt: initialJoinedAt,
      admittedAt: initialAdmittedAt,
    },
    fetchState,
  });

  // ---------- Live wait counter ----------
  // We tick every 1s while we have a joinedAt and no admittedAt. Once
  // the admit lands, the counter freezes (card disappears immediately
  // after via the early-return below — so the frozen value is
  // unreachable in normal flow, but defensively correct).
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!joinedAt || admittedAt) return;
    const intervalId = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(intervalId);
  }, [joinedAt, admittedAt]);

  // Derived patient bio strings — memoised because dob/gender don't
  // change in the lifetime of this card.
  const bioLine = useMemo(() => {
    const parts: string[] = [];
    const sex = fmtSex(gender);
    if (sex) parts.push(sex);
    const age = calcAgeYears(dateOfBirth);
    if (age != null) parts.push(`${age} yrs`);
    return parts.join(" · ");
  }, [dateOfBirth, gender]);

  const waitDisplay = useMemo(() => {
    if (!joinedAt) return null;
    const start = new Date(joinedAt).getTime();
    if (!Number.isFinite(start)) return null;
    return fmtWait(Date.now() - start);
  }, [joinedAt]);

  // ---------- Admit action ----------
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Local hide: optimistically remove the card on a successful admit
  // even before the parent's next render cycle catches up.
  const [locallyAdmitted, setLocallyAdmitted] = useState(false);

  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const handleAdmit = async () => {
    if (pending) return;
    setPending(true);
    setErr(null);
    try {
      const res = await fetch("/api/doctor/admit-patient", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        doctor_admitted_at?: string;
      };
      if (!res.ok || !data?.ok) {
        setErr(data?.error ?? "Could not admit patient. Please try again.");
        setPending(false);
        return;
      }
      // Optimistic local hide; the realtime hook will also catch up.
      setLocallyAdmitted(true);
    } catch (e) {
      console.error("[patient-ready-card] admit failed", e);
      setErr("Network error. Please try again.");
      setPending(false);
    }
  };

  // ---------- Hide if admitted (live OR optimistic) ----------
  if (admittedAt || locallyAdmitted) return null;

  // ---------- Hide if patient hasn't joined yet ----------
  // Parent may render this card whenever the session is in the queue;
  // we self-suppress until the patient is actually in the waiting room.
  if (!joinedAt) return null;

  // ---------- Render ----------
  return (
    <div className="bg-white border border-sky-200 rounded-2xl overflow-hidden mb-4 shadow-sm">
      <div className="px-6 py-3 border-b border-sky-100 bg-sky-50 flex items-baseline justify-between">
        <div className="inline-flex items-center gap-2 text-sky-900 font-semibold text-sm">
          <CheckCircle2 className="w-4 h-4" />
          Patient Ready
        </div>
        {waitDisplay && (
          <div className="inline-flex items-center gap-1.5 text-xs font-mono text-sky-700 tabular-nums">
            <Clock className="w-3.5 h-3.5" />
            Waiting: {waitDisplay}
          </div>
        )}
      </div>

      <div className="px-6 py-4">
        {/* Patient bio line */}
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-slate-100 inline-flex items-center justify-center shrink-0">
            <User className="w-5 h-5 text-slate-500" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-slate-900 truncate">
              {patientName ?? "Patient"}
              {bioLine ? (
                <span className="ml-2 text-sm font-normal text-slate-500">
                  · {bioLine}
                </span>
              ) : null}
            </div>
            <div className="text-[11px] font-mono text-slate-500">
              {bookingCode ?? "—"}
              {customerCode ? <span className="ml-2">· {customerCode}</span> : null}
            </div>
          </div>
        </div>

        {/* Joined-at line. Drives the wait counter; the absolute time is
            useful when the doctor opens the card minutes later. */}
        {joinedAt && (
          <div className="text-xs text-slate-500 mb-3">
            Joined at{" "}
            {new Date(joinedAt).toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}{" "}
            IST
          </div>
        )}

        {/* Presenting complaint */}
        <div className="mb-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
            Presenting complaint
          </div>
          <div className="text-sm text-slate-800">
            {presentingComplaint && presentingComplaint.trim() !== "" ? (
              `"${presentingComplaint.trim()}"`
            ) : (
              <span className="italic text-slate-400">
                Not provided at booking time
              </span>
            )}
          </div>
        </div>

        {/* Previous consults */}
        <div className="mb-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
            Previous consults
          </div>
          <div className="text-sm text-slate-800">
            {priorRxCount === 0
              ? "None"
              : `${priorRxCount} previous Rx with Sanocare`}
          </div>
        </div>

        {err && (
          <div className="flex items-start gap-2 text-rose-700 text-xs bg-rose-50 border border-rose-200 rounded-lg p-2 mb-3">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {err}
          </div>
        )}

        <button
          ref={buttonRef}
          type="button"
          onClick={handleAdmit}
          disabled={pending}
          className={
            "w-full inline-flex items-center justify-center gap-2 text-sm font-semibold py-2.5 rounded-xl transition-colors " +
            (pending
              ? "bg-slate-300 text-slate-500 cursor-wait"
              : "bg-[#2B81FF] hover:bg-[#1E6BD6] text-white")
          }
        >
          {pending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Admitting…
            </>
          ) : (
            <>Admit Patient</>
          )}
        </button>
      </div>
    </div>
  );
}
