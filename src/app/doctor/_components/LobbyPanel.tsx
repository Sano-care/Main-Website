"use client";

/**
 * LobbyPanel — clinic-lobby admit control (PR #22 redirect).
 *
 * Replaces the standalone PatientReadyCard on the /doctor home queue.
 * Real-world doctor flow is closer to a clinic reception model:
 *   - Reception (the waiting lobby) is OUTSIDE the consult room.
 *   - The doctor calls patients in one at a time.
 *   - The doctor can send a patient back briefly (taking vitals,
 *     consulting a colleague, brief break).
 *   - The doctor formally marks the consult attended when done.
 *
 * The panel sits as a floating FAB inside DutyRoomEmbed, always
 * visible (whether the Daily iframe is mounted or not). The FAB
 * badge counts (waiting + in_call). Click opens a right-side slide-
 * in panel ~35vw with two tabs:
 *
 *   Waiting  — patient hit /c/[token] but not yet admitted.
 *              Action: Admit Patient.
 *   In Call  — doctor admitted but consult not yet attended.
 *              Actions: Send to Waiting (clear admit), Mark Attended
 *              (stamp ended_at).
 *
 * Source of truth: GET /api/doctor/lobby-state (polled every 5s).
 * No new column — state derived from joined_at +
 * doctor_admitted_at + ended_at.
 *
 * Carries QA fixes from PR #22 round 1:
 *   - 24h cutoff on Waiting tab (kills legacy stale joined_at rows)
 *   - Patient name fallback: customer.full_name → bookings.patient_name
 *     → "Patient" (handled server-side in lobby-state)
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  X,
  Users,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  ArrowLeft,
  UserCheck,
  User,
} from "lucide-react";

export type LobbyPanelSessionInfo = {
  session_id: string;
  booking_code: string | null;
  joined_at: string | null;
  doctor_admitted_at: string | null;
  patient_name: string | null;
  customer_code: string | null;
  date_of_birth: string | null;
  gender: string | null;
  specific_ailment: string | null;
};

type LobbyState = {
  waiting: LobbyPanelSessionInfo[];
  in_call: LobbyPanelSessionInfo[];
};

type Tab = "waiting" | "in_call";

const POLL_INTERVAL_MS = 5000;

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
  if (u === "U") return null;
  return g;
}

function fmtWait(ms: number): string {
  if (ms < 0) ms = 0;
  const secs = Math.floor(ms / 1000);
  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function LobbyPanel() {
  const [state, setState] = useState<LobbyState>({ waiting: [], in_call: [] });
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("waiting");
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // ===== Polling loop — 5s cadence =====
  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/doctor/lobby-state", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) {
        // Auth/session loss = stop showing stale data. Swallow other
        // transient errors; next interval retries.
        if (res.status === 401) {
          setState({ waiting: [], in_call: [] });
        }
        return;
      }
      const data = (await res.json()) as LobbyState;
      setState((prev) => {
        // Skip a re-render when nothing meaningful changed. We compare
        // the cheap shape — session ids in each tab + their join /
        // admit timestamps.
        const prevSig = JSON.stringify([
          prev.waiting.map((s) => [s.session_id, s.joined_at]),
          prev.in_call.map((s) => [s.session_id, s.doctor_admitted_at]),
        ]);
        const nextSig = JSON.stringify([
          data.waiting.map((s) => [s.session_id, s.joined_at]),
          data.in_call.map((s) => [s.session_id, s.doctor_admitted_at]),
        ]);
        return prevSig === nextSig ? prev : data;
      });
    } catch {
      // Network blip — try again next interval.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Fire once on mount, then every 5s.
    void fetchState();
    const intervalId = setInterval(() => {
      if (cancelled) return;
      void fetchState();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [fetchState]);

  // Re-tick every second so the wait counter on each Waiting row
  // increments visibly. One interval drives all rows — they each
  // compute their own elapsed value off Date.now() vs joined_at.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (state.waiting.length === 0 && state.in_call.length === 0) return;
    const intervalId = setInterval(
      () => forceTick((n) => n + 1),
      1000,
    );
    return () => clearInterval(intervalId);
  }, [state.waiting.length, state.in_call.length]);

  const badgeCount = state.waiting.length + state.in_call.length;
  const nowMs = Date.now();

  // ===== Actions =====
  // All three endpoints are idempotent + return a clear ok/error
  // payload. We disable the corresponding button while pending and
  // refresh lobby state immediately on success so the row jumps tabs
  // without waiting for the next 5s poll.
  const callAction = useCallback(
    async (path: string, sessionId: string): Promise<boolean> => {
      setPendingSessionId(sessionId);
      setActionError(null);
      try {
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!res.ok || !data?.ok) {
          setActionError(data?.error ?? "Action failed. Please try again.");
          return false;
        }
        // Refresh immediately so the UI reflects the new state without
        // waiting for the next polling tick.
        await fetchState();
        return true;
      } catch {
        setActionError("Network error. Please try again.");
        return false;
      } finally {
        setPendingSessionId(null);
      }
    },
    [fetchState],
  );

  const handleAdmit = (sessionId: string) =>
    callAction("/api/doctor/admit-patient", sessionId);
  const handleSendToWaiting = (sessionId: string) =>
    callAction("/api/doctor/send-to-waiting", sessionId);
  const handleMarkAttended = (sessionId: string) =>
    callAction("/api/doctor/mark-attended", sessionId);

  // Auto-switch to the In Call tab when the doctor admits a patient —
  // they just acted on a Waiting row; In Call is what they want to see
  // next. This is purely a UX nicety; the panel stays open.
  const handleAdmitWithSwitch = async (sessionId: string) => {
    const ok = await handleAdmit(sessionId);
    if (ok) setTab("in_call");
  };

  return (
    <>
      {/* ===== FAB ===== */}
      {/* Anchored to the bottom-right of the embed wrapper (DutyRoomEmbed
          places this inside the iframe overlay when in-call AND inside
          the idle button surface; always visible). We use fixed
          positioning so it survives the in-call fullscreen overlay
          (which is also fixed inset-0 z-50). z-[70] sits above the
          overlay (z-50) and above the Rx FAB (z-[60]). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open patient lobby (${badgeCount} active)`}
        className="fixed bottom-6 right-6 z-[70] inline-flex items-center justify-center w-14 h-14 rounded-full shadow-2xl bg-[#2B81FF] hover:bg-[#1E6BD6] text-white transition-colors ring-2 ring-white/30"
      >
        <Users className="w-6 h-6" />
        {badgeCount > 0 && (
          <span
            className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-rose-500 text-white text-xs font-semibold ring-2 ring-white"
            aria-hidden="true"
          >
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
      </button>

      {/* ===== Slide-in panel ===== */}
      {/* Renders only when open. z-[71] sits one above the FAB so its
          dismiss-clicks don't pass through to the in-call overlay. The
          panel itself is right-anchored at ~35vw width, full-height. */}
      {open && (
        <>
          {/* Click-out backdrop */}
          <div
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[71] bg-slate-900/40 backdrop-blur-sm"
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-label="Patient lobby"
            className="fixed top-0 right-0 z-[72] h-screen w-[35vw] min-w-[360px] max-w-[560px] bg-white shadow-2xl border-l border-slate-200 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                  Patient Lobby
                </div>
                <div className="text-base font-semibold text-slate-900">
                  {badgeCount === 0
                    ? "No patients right now"
                    : `${badgeCount} active`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close patient lobby"
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-200">
              <TabButton
                label="Waiting"
                count={state.waiting.length}
                active={tab === "waiting"}
                onClick={() => setTab("waiting")}
              />
              <TabButton
                label="In Call"
                count={state.in_call.length}
                active={tab === "in_call"}
                onClick={() => setTab("in_call")}
              />
            </div>

            {actionError && (
              <div className="mx-4 mt-3 flex items-start gap-2 text-rose-700 text-xs bg-rose-50 border border-rose-200 rounded-lg p-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {actionError}
              </div>
            )}

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {tab === "waiting" && (
                <>
                  {state.waiting.length === 0 ? (
                    <EmptyState
                      label="No patients waiting"
                      hint="Patients who tap their WhatsApp link will appear here. You'll see them within ~5s of arrival."
                    />
                  ) : (
                    state.waiting.map((s) => (
                      <SessionRow
                        key={s.session_id}
                        info={s}
                        nowMs={nowMs}
                        pending={pendingSessionId === s.session_id}
                        primary={{
                          label: "Admit Patient",
                          icon: <UserCheck className="w-3.5 h-3.5" />,
                          onClick: () => handleAdmitWithSwitch(s.session_id),
                        }}
                      />
                    ))
                  )}
                </>
              )}

              {tab === "in_call" && (
                <>
                  {state.in_call.length === 0 ? (
                    <EmptyState
                      label="No active consults"
                      hint="Once you admit a patient, they'll show here so you can send them back or mark the consult attended."
                    />
                  ) : (
                    state.in_call.map((s) => (
                      <SessionRow
                        key={s.session_id}
                        info={s}
                        nowMs={nowMs}
                        pending={pendingSessionId === s.session_id}
                        secondary={{
                          label: "Send to Waiting",
                          icon: <ArrowLeft className="w-3.5 h-3.5" />,
                          onClick: () => handleSendToWaiting(s.session_id),
                        }}
                        primary={{
                          label: "Mark Attended",
                          icon: <CheckCircle2 className="w-3.5 h-3.5" />,
                          onClick: () => handleMarkAttended(s.session_id),
                          tone: "emerald",
                        }}
                      />
                    ))
                  )}
                </>
              )}
            </div>
          </aside>
        </>
      )}
    </>
  );
}

// ===== Sub-components =====

function TabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex-1 py-3 text-sm font-medium border-b-2 transition-colors " +
        (active
          ? "border-[#2B81FF] text-slate-900"
          : "border-transparent text-slate-500 hover:text-slate-700")
      }
    >
      {label}
      <span
        className={
          "ml-1.5 inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full text-[10px] font-semibold " +
          (active
            ? "bg-[#2B81FF] text-white"
            : "bg-slate-100 text-slate-600")
        }
      >
        {count}
      </span>
    </button>
  );
}

function EmptyState({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="text-center py-10 px-4">
      <Users className="w-8 h-8 text-slate-300 mx-auto mb-3" />
      <div className="text-sm font-medium text-slate-700">{label}</div>
      <div className="text-xs text-slate-500 mt-1.5 max-w-[280px] mx-auto">
        {hint}
      </div>
    </div>
  );
}

function SessionRow({
  info,
  nowMs,
  pending,
  primary,
  secondary,
}: {
  info: LobbyPanelSessionInfo;
  nowMs: number;
  pending: boolean;
  primary: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    tone?: "blue" | "emerald";
  };
  secondary?: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
  };
}) {
  const bioLine = useMemo(() => {
    const parts: string[] = [];
    const sex = fmtSex(info.gender);
    if (sex) parts.push(sex);
    const age = calcAgeYears(info.date_of_birth);
    if (age != null) parts.push(`${age} yrs`);
    return parts.join(" · ");
  }, [info.date_of_birth, info.gender]);

  const referenceTime = info.doctor_admitted_at ?? info.joined_at;
  const elapsedDisplay = useMemo(() => {
    if (!referenceTime) return null;
    const start = new Date(referenceTime).getTime();
    if (!Number.isFinite(start)) return null;
    return fmtWait(nowMs - start);
  }, [referenceTime, nowMs]);

  const elapsedLabel = info.doctor_admitted_at ? "In call" : "Waiting";

  const primaryToneClasses =
    primary.tone === "emerald"
      ? "bg-emerald-600 hover:bg-emerald-700 text-white"
      : "bg-[#2B81FF] hover:bg-[#1E6BD6] text-white";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-full bg-slate-100 inline-flex items-center justify-center shrink-0">
          <User className="w-4 h-4 text-slate-500" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-900 text-sm truncate">
            {info.patient_name ?? "Patient"}
            {bioLine ? (
              <span className="ml-1.5 text-xs font-normal text-slate-500">
                · {bioLine}
              </span>
            ) : null}
          </div>
          <div className="text-[10px] font-mono text-slate-500 truncate">
            {info.booking_code ?? "—"}
            {info.customer_code ? (
              <span className="ml-2">· {info.customer_code}</span>
            ) : null}
          </div>
        </div>
        {elapsedDisplay && (
          <div className="text-right shrink-0">
            <div className="text-[9px] font-mono uppercase tracking-wider text-slate-500">
              {elapsedLabel}
            </div>
            <div className="inline-flex items-center gap-1 text-xs font-mono tabular-nums text-slate-700">
              <Clock className="w-3 h-3" />
              {elapsedDisplay}
            </div>
          </div>
        )}
      </div>

      {info.specific_ailment && info.specific_ailment.trim() !== "" && (
        <div className="text-xs text-slate-600 mb-2 line-clamp-2">
          &ldquo;{info.specific_ailment.trim()}&rdquo;
        </div>
      )}

      <div className="flex items-center gap-2">
        {secondary && (
          <button
            type="button"
            onClick={secondary.onClick}
            disabled={pending}
            className={
              "flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-lg border " +
              (pending
                ? "border-slate-200 text-slate-400 cursor-wait"
                : "border-slate-300 text-slate-700 hover:bg-slate-50")
            }
          >
            {secondary.icon}
            {secondary.label}
          </button>
        )}
        <button
          type="button"
          onClick={primary.onClick}
          disabled={pending}
          className={
            "flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg " +
            (pending
              ? "bg-slate-300 text-slate-500 cursor-wait"
              : primaryToneClasses)
          }
        >
          {pending ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Working…
            </>
          ) : (
            <>
              {primary.icon}
              {primary.label}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
