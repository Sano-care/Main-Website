"use client";

/**
 * useSessionAdmitState — shared realtime/polling hook for the Consult
 * Room admit-gate (Task #43, M029 → consultation_sessions.doctor_admitted_at).
 *
 * Returns the two timestamps that gate the patient-side state machine
 * + the doctor-side Patient Ready card:
 *
 *   - joinedAt    = consultation_participants.joined_at (patient row),
 *                   set when the patient first POSTs /api/consultation/
 *                   join/[token]. Drives the doctor's "patient is in
 *                   the waiting room" signal.
 *
 *   - admittedAt  = consultation_sessions.doctor_admitted_at, set by
 *                   POST /api/doctor/admit-patient when the doctor
 *                   clicks Admit on the Patient Ready card. Drives the
 *                   patient's transition from waiting room → Daily.
 *
 * Both sides of the consult need the same two values; both sides need
 * them updated live. The hook is the shared primitive.
 *
 * Realtime + polling — why both
 * ---------------------------------------------------------------------
 * Supabase Realtime's postgres_changes feed respects RLS. Today the
 * consultation_* tables expose SELECT to ops_users only (M021); neither
 * the patient (unauthenticated) nor the doctor (cookie-authed, no
 * Supabase auth session) can SELECT these rows from the anon client.
 * The realtime subscription will therefore typically be REJECTED for
 * this hook's callers. We still TRY it — Supabase's API is fast when
 * it works, and a future PR may grant a narrow per-token SELECT policy
 * or move to a broadcast channel pattern, after which realtime kicks
 * in automatically.
 *
 * Polling is the guaranteed-correct primary path for v1. The hook
 * polls every `pollIntervalMs` via the caller-supplied `fetchState`
 * function — patient side hits a token-gated /api/consultation/...
 * endpoint; doctor side hits a doctor-cookie-gated /api/doctor/...
 * endpoint. Same hook signature, different auth surfaces.
 *
 * Initial state
 * ---------------------------------------------------------------------
 * The server has already loaded the current admit/joined timestamps
 * during SSR (via service-role / supabaseAdmin) and passed them in
 * via `initial`. The hook seeds its state from initial so first render
 * is correct without waiting for a network round-trip. Realtime +
 * polling only fire after mount.
 */

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

export type SessionAdmitState = {
  /** consultation_participants.joined_at for the patient row. */
  joinedAt: string | null;
  /** consultation_sessions.doctor_admitted_at. Can flip non-null →
   *  null when the doctor clicks Send to Waiting; the patient client
   *  uses the direction of the transition to mount/unmount Daily. */
  admittedAt: string | null;
  /** consultation_sessions.ended_at — stamped by POST
   *  /api/doctor/mark-attended. Once non-null, the patient transitions
   *  to the Sanocare post-consult screen and Daily unmounts. */
  endedAt: string | null;
  /** Derived from consultation_sessions.first_admitted_at IS NOT NULL
   *  (M031). True iff the doctor has admitted this session AT LEAST
   *  ONCE historically — regardless of whether they're currently
   *  admitted (admittedAt) or in a Send-to-Waiting hold (admittedAt
   *  null but wasEverAdmitted true). Powers the patient waiting-
   *  screen copy split: false → "Dr will admit you shortly"; true →
   *  "Dr stepped out for a moment". */
  wasEverAdmitted: boolean;
};

export type UseSessionAdmitStateArgs = {
  /**
   * consultation_sessions.id. Used both for the realtime filter and as
   * the unique channel name so multiple session subscriptions don't
   * cross-talk inside one tab.
   */
  sessionId: string;
  /** SSR-loaded starting values. The hook returns these on first render. */
  initial: SessionAdmitState;
  /**
   * Network fetch that returns the current { joinedAt, admittedAt } for
   * this session. Called by the polling loop. Caller supplies this so
   * the hook is auth-agnostic — patient side passes a token-gated
   * fetcher, doctor side passes a cookie-gated fetcher.
   */
  fetchState: () => Promise<SessionAdmitState>;
  /**
   * Polling cadence in milliseconds. Defaults to 5000 (5s) — the brief's
   * stated fallback target.
   */
  pollIntervalMs?: number;
};

export function useSessionAdmitState(args: UseSessionAdmitStateArgs): SessionAdmitState {
  const { sessionId, initial, fetchState, pollIntervalMs = 5000 } = args;

  const [state, setState] = useState<SessionAdmitState>(initial);

  // Re-seed state if the parent ever hands us a new sessionId/initial pair
  // (e.g., the user navigates to a different session in the same tab).
  // We don't merge — the new session has its own fresh state space.
  const lastSeededSession = useRef<string>(sessionId);
  useEffect(() => {
    if (lastSeededSession.current !== sessionId) {
      lastSeededSession.current = sessionId;
      setState(initial);
    }
    // initial is intentionally NOT in the dep array — parents may
    // recompute the initial object on every render without meaning
    // anything; we only re-seed on a session change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ---------- Polling (the guaranteed-correct path) ----------
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await fetchState();
        if (cancelled) return;
        setState((prev) => {
          // Skip a setState if nothing actually changed — avoids a
          // re-render on every poll when the timestamps haven't moved.
          if (
            prev.joinedAt === next.joinedAt &&
            prev.admittedAt === next.admittedAt &&
            prev.endedAt === next.endedAt &&
            prev.wasEverAdmitted === next.wasEverAdmitted
          ) {
            return prev;
          }
          return next;
        });
      } catch {
        // Polling errors are swallowed — they're typically transient
        // (network blip, server cold start). The next interval will
        // try again. Surfacing them to the UI would be more disruptive
        // than the brief failure mode.
      }
    };
    const intervalId = setInterval(tick, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
    // fetchState is allowed to be a fresh closure on every render —
    // we intentionally don't depend on it; if the caller wants to
    // change the fetcher mid-session they should remount the hook
    // via a key prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, pollIntervalMs]);

  // ---------- Realtime (best-effort overlay on polling) ----------
  //
  // Postgres_changes respects RLS. For the current consultation_*
  // policies (ops_users only) this subscription will most likely be
  // rejected for anon callers, in which case the channel never acks
  // and no update events flow. That's fine — polling carries the day.
  //
  // A future ticket can grant a narrow per-token SELECT policy (or
  // move to a Supabase broadcast channel) and this code starts
  // receiving updates without any caller-side change.
  useEffect(() => {
    let cancelled = false;
    const channel = supabase
      .channel(`session-admit-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "consultation_sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          if (cancelled) return;
          const next = payload.new as {
            doctor_admitted_at: string | null;
            ended_at: string | null;
            first_admitted_at: string | null;
          };
          // Use the payload values directly — null is a legitimate
          // value here (e.g., Send to Waiting clears
          // doctor_admitted_at), so we cannot fall back to prev.
          setState((prev) => ({
            ...prev,
            admittedAt: next.doctor_admitted_at,
            endedAt: next.ended_at,
            // wasEverAdmitted only flips false → true (M031 column is
            // immutable once set). If the payload omits the field
            // — narrow schemas, partial replication — fall back to
            // prev to avoid spuriously flipping back to false.
            wasEverAdmitted:
              next.first_admitted_at != null || prev.wasEverAdmitted,
          }));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "consultation_participants",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          if (cancelled) return;
          const next = payload.new as { joined_at: string | null };
          setState((prev) => ({
            ...prev,
            joinedAt: next.joined_at ?? prev.joinedAt,
          }));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      // removeChannel returns a promise; we don't await — React unmount
      // is synchronous and the cleanup is best-effort.
      void supabase.removeChannel(channel);
    };
  }, [sessionId]);

  return state;
}
