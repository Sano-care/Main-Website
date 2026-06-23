"use client";

import { useEffect, useRef } from "react";

/**
 * usePresenceHeartbeat — C3 Duty-Room presence ping.
 *
 * POSTs /api/consultation/presence on mount and every `intervalMs` while the
 * tab is visible. The endpoint upserts the signed-in doctor's
 * doctor_presence_log row (first_login_at once per IST day, last_seen_at each
 * beat); M063's bridge trigger turns sustained presence into salaried
 * attendance + daily wage entirely DB-side. The hook carries no identity —
 * the endpoint reads doctor_id from the session cookie.
 *
 * Cadence:
 *   - Beat immediately on mount — records first_login_at for the day.
 *   - Beat every intervalMs (default 60s) ONLY while
 *     document.visibilityState === 'visible'. A backgrounded tab shouldn't
 *     accrue presence the doctor isn't actually giving.
 *   - Beat once when the tab returns to visible, so last_seen_at refreshes
 *     promptly instead of waiting up to a full interval.
 *   - Best-effort final beat on pagehide via sendBeacon — keeps last_seen_at
 *     fresh right up to navigation/close. The beacon carries the cookie
 *     same-origin and an empty body (the endpoint ignores the body).
 *
 * Errors are swallowed — same posture as useSessionAdmitState's poll loop. A
 * missed beat self-heals on the next interval; presence is append-forward, so
 * nothing is lost by a dropped ping.
 */
export function usePresenceHeartbeat(intervalMs: number = 60_000): void {
  // Guards against a slow request overlapping the next interval tick.
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const beat = async () => {
      if (cancelled) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        await fetch("/api/consultation/presence", {
          method: "POST",
          cache: "no-store",
          keepalive: true,
        });
      } catch {
        // swallow — the next interval retries
      } finally {
        inFlight.current = false;
      }
    };

    // Mount beat (stamps first_login_at for the day).
    void beat();

    const intervalId = setInterval(() => void beat(), intervalMs);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void beat();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onPageHide = () => {
      // Final best-effort ping; sendBeacon survives the unload where a
      // fetch() would be cancelled. Empty body — identity is the cookie.
      try {
        navigator.sendBeacon?.("/api/consultation/presence");
      } catch {
        // ignore
      }
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [intervalMs]);
}
