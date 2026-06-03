"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Video,
  Loader2,
  AlertCircle,
  ShieldCheck,
  CheckCircle2,
  Stethoscope,
  Clock,
} from "lucide-react";
import { useSessionAdmitState } from "@/lib/realtime/useSessionAdmitState";
import { MicBlockedBanner } from "./_components/MicBlockedBanner";

/**
 * The interactive part of /c/[token]. Drives the patient's journey from
 * consent → Sanocare-native waiting room → Daily-embedded video call
 * → ended state.
 *
 * C2-V (PR #11): patient never leaves sanocare.in; Daily Prebuilt is
 * embedded.
 *
 * Task #43 (M029, this PR): the Sanocare-native waiting room sits
 * BETWEEN consent and the Daily mount. The patient consents, hits a
 * branded "Dr X will admit you shortly" screen, and the Daily iframe
 * only mounts once consultation_sessions.doctor_admitted_at flips
 * non-null (driven by the doctor's POST /api/doctor/admit-patient
 * click on the Patient Ready card). The transition is live via the
 * useSessionAdmitState hook (realtime postgres_changes attempt + 5s
 * polling fallback).
 *
 * Lifecycle states:
 *   "consent"       — show consent checkbox + Join button.
 *   "waiting-room"  — Sanocare waiting screen; Daily NOT mounted yet.
 *                     Realtime/polling watches for doctor_admitted_at.
 *   "joining"       — admit landed → POST to mint a Daily token +
 *                     dynamic-import the SDK.
 *   "in-call"       — iframe mounted, Daily owns the UI.
 *   "ended"         — frame.on("left-meeting") fired.
 *   "error"         — surfaced on fetch / mint / iframe error.
 */
type ClientState =
  | "consent"
  | "waiting-room"
  | "joining"
  | "in-call"
  | "ended"
  | "error";

// We type Daily's DailyIframe loosely — full types come from
// @daily-co/daily-js but we don't import them at module scope (we
// dynamic-import to keep the bundle off the initial paint).
type DailyFrameLike = {
  join: (opts: { url: string; token: string }) => Promise<unknown>;
  destroy: () => Promise<unknown>;
  on: (event: string, handler: (e: unknown) => void) => unknown;
};

export function PatientJoinClient({
  token,
  patientName,
  alreadyConsented,
  sessionId,
  initialJoinedAt,
  initialAdmittedAt,
  initialEndedAt,
  initialWasEverAdmitted,
  doctorFullName,
  doctorQualification,
  scheduledAt,
}: {
  token: string;
  patientName: string | null;
  alreadyConsented: boolean;
  /** consultation_sessions.id — used by the admit-state hook. */
  sessionId: string;
  /** SSR-loaded consultation_participants.joined_at — non-null if the
   *  patient already POSTed /api/consultation/join previously
   *  (re-tapping the link). */
  initialJoinedAt: string | null;
  /** SSR-loaded consultation_sessions.doctor_admitted_at. If already
   *  non-null at page load (doctor admitted before the patient even
   *  refreshed), we skip the waiting-room state and go straight to
   *  joining. */
  initialAdmittedAt: string | null;
  /** SSR-loaded consultation_sessions.ended_at. If already non-null
   *  at page load, the patient lands directly on the post-consult
   *  screen — they re-tapped the WhatsApp link after the consult
   *  was wrapped. */
  initialEndedAt: string | null;
  /** SSR-derived from consultation_sessions.first_admitted_at IS NOT
   *  NULL (M031). Drives the brief-hold vs initial-wait copy split
   *  on the waiting screen. */
  initialWasEverAdmitted: boolean;
  doctorFullName: string;
  doctorQualification: string | null;
  scheduledAt: string;
}) {
  const [consented, setConsented] = useState(alreadyConsented);
  // Initial state: if the doctor already admitted before the patient
  // landed (rare — doctor saw a Patient Ready card from an earlier
  // tap and admitted instantly), start in "consent" but flag to
  // auto-advance to joining once consent is acknowledged.
  const [state, setState] = useState<ClientState>("consent");
  const [error, setError] = useState<string | null>(null);
  // T52: mic-permission denied banner. Set true when Daily emits a
  // 'camera-error' with type='permissions' AND blockedMedia includes
  // 'audio'. Dismissible via the × on the banner. No auto-hide wire —
  // Daily's own in-iframe mic icon owns the retry flow; patient closes
  // the banner manually once their mic works.
  const [micBlocked, setMicBlocked] = useState(false);

  // ---- Realtime/polling on the session's admit state ----
  //
  // The patient-side polling endpoint is token-gated (the join token
  // IS the auth). The hook attempts a postgres_changes sub in parallel
  // (best-effort under current RLS) and always runs the 5s poll.
  //
  // Three signals drive transitions (PR #22 redirect — clinic-lobby
  // model with Send to Waiting + Mark Attended):
  //   admittedAt: null → non-null    →  mount Daily (waiting → joining)
  //   admittedAt: non-null → null    →  unmount Daily, re-show waiting
  //                                     (doctor clicked Send to Waiting)
  //   endedAt:    null → non-null    →  unmount Daily, show post-consult
  //                                     (doctor clicked Mark Attended)
  const fetchAdmitState = useCallback(async () => {
    const res = await fetch(`/api/consultation/admit-state/${token}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`admit-state ${res.status}`);
    const data = (await res.json()) as {
      joinedAt: string | null;
      admittedAt: string | null;
      endedAt: string | null;
      wasEverAdmitted: boolean;
    };
    return data;
  }, [token]);

  const { admittedAt, endedAt, wasEverAdmitted } = useSessionAdmitState({
    sessionId,
    initial: {
      joinedAt: initialJoinedAt,
      admittedAt: initialAdmittedAt,
      endedAt: initialEndedAt,
      wasEverAdmitted: initialWasEverAdmitted,
    },
    fetchState: fetchAdmitState,
  });

  // Pre-resolved Daily join args, populated by the POST response and
  // consumed by the useEffect that mounts the iframe.
  const [dailyArgs, setDailyArgs] = useState<{
    roomUrl: string;
    meetingToken: string;
  } | null>(null);

  // The iframe mount target. ref.current is the <div> we hand to
  // DailyIframe.createFrame(). Daily injects its own iframe inside.
  const containerRef = useRef<HTMLDivElement | null>(null);

  // We keep the live DailyIframe instance in a ref (not state) — it's
  // a heavy object, not safe to put in React state, and we only need
  // it to destroy on unmount.
  const frameRef = useRef<DailyFrameLike | null>(null);

  // ===== Body scroll lock during in-call (v6) =====
  //
  // When the Daily iframe goes fullscreen, lock document.body
  // overflow so the patient can't accidentally scroll the host page
  // behind the iframe (iOS Safari rubber-band, scroll wheel on
  // desktop, etc.). Restored on cleanup so the consent screen,
  // ended-state surface, and parent page chrome all scroll normally
  // outside the in-call window.
  useEffect(() => {
    if (state !== "in-call") return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [state]);

  // ===== Mount Daily Prebuilt EXACTLY ONCE per dailyArgs lifecycle =====
  //
  // Mirror of the v4 fix applied to DutyRoomEmbed.tsx (doctor side).
  // The pre-v5 dep array was [state, dailyArgs] and the inner guard
  // was `state !== "joining"`. When 'joined-meeting' fired, the
  // handler set state="in-call"; the dep change re-ran THIS effect,
  // executed its cleanup (frame.destroy()), and then re-mounted via
  // createFrame + frame.join() with the SAME (now already-used)
  // meeting token. The second join() failed; catch set
  // state="error" → blank iframe rect, error banner.
  //
  // v5 fix: depend on `dailyArgs` only. The effect mounts when args
  // land, stays mounted across state transitions, and cleans up
  // exactly when dailyArgs is cleared (handleRetry / left-meeting /
  // error / catch). Same shape as doctor v4 in
  // src/app/doctor/_components/DutyRoomEmbed.tsx.
  useEffect(() => {
    if (!dailyArgs) return;
    if (!containerRef.current) return;

    let cancelled = false;
    (async () => {
      try {
        const mod = await import("@daily-co/daily-js");
        if (cancelled) return;
        // The package's default export is the DailyIframe class.
        // Some bundlers wrap with .default, some don't — defensive.
        const DailyIframe =
          (mod as { default?: unknown }).default ?? (mod as unknown);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Factory = DailyIframe as any;

        const frame: DailyFrameLike = Factory.createFrame(
          containerRef.current as HTMLElement,
          {
            // Daily Prebuilt iframe layout — fill the container.
            iframeStyle: {
              position: "absolute",
              inset: "0",
              width: "100%",
              height: "100%",
              border: "0",
              borderRadius: "16px",
            },
            // Sanocare brand theming (matches the home / portal palette).
            theme: {
              colors: {
                accent: "#1f6feb",
                accentText: "#ffffff",
                background: "#ffffff",
                backgroundAccent: "#f8fafc",
                baseText: "#0f172a",
                border: "#e2e8f0",
                mainAreaBg: "#f8fafc",
                mainAreaBgAccent: "#ffffff",
                mainAreaText: "#0f172a",
                supportiveText: "#475569",
              },
            },
            // Daily Prebuilt UX flags. We deliberately do NOT try to
            // skip Daily's prejoin UI here — see the doctor-side
            // post-mortems in DutyRoomEmbed.tsx for the v1 (silent
            // no-op showPrejoinUI) and v2 (token-level
            // enable_prejoin_ui not in request schema) failure modes.
            // For the patient, prejoin is also genuinely useful —
            // they get to test camera/mic before being admitted.
            showLeaveButton: true,
            // v6.1: parity with the doctor side. With v6's
            // fixed-inset-0 wrapper the iframe already fills the
            // viewport, but tapping Daily's fullscreen icon
            // additionally requests browser fullscreen (URL bar +
            // system chrome hide) for true edge-to-edge video.
            // Tap again to exit fullscreen and return to v6's
            // viewport-fullscreen.
            showFullscreenButton: true,
          },
        );

        frameRef.current = frame;

        frame.on("joined-meeting", () => {
          // Telemetry parallel to doctor's [duty-room-embed]
          // joined-meeting log — pins any regression of the
          // remount-on-join bug immediately on MCP probes.
          console.log("[patient-join-client] joined-meeting", {
            cancelled,
            frameAlive: !!frameRef.current,
          });
          if (!cancelled) setState("in-call");
        });
        frame.on("left-meeting", () => {
          console.log("[patient-join-client] left-meeting", { cancelled });
          if (!cancelled) {
            setState("ended");
            // Clear dailyArgs so the effect cleanup runs and destroys
            // the frame (render falls through to the "Call ended"
            // surface where containerRef is no longer in the DOM).
            setDailyArgs(null);
          }
        });
        frame.on("error", (e: unknown) => {
          console.error("[patient-join-client] Daily error event", e);
          if (!cancelled) {
            setError("The call disconnected unexpectedly. Please rejoin.");
            setState("error");
            setDailyArgs(null);
          }
        });
        // T52: mic-permission detection. Daily's 'camera-error' event
        // (poorly named — covers mic too) fires with a permissions
        // payload when the browser blocks audio. We narrow to
        // type === 'permissions' AND blockedMedia includes 'audio' to
        // avoid surfacing the banner for camera-only blocks (patient
        // chose to disable camera — out of scope per the brief).
        // Other camera-error types ('mic-in-use', 'not-found') are NOT
        // caught here — Daily Prebuilt's own in-iframe UI shows those
        // errors; we don't want two surfaces racing on the same event.
        frame.on("camera-error", (e: unknown) => {
          const evt = e as {
            type?: string;
            blockedMedia?: Array<string>;
          } | null;
          if (
            !cancelled &&
            evt?.type === "permissions" &&
            Array.isArray(evt.blockedMedia) &&
            evt.blockedMedia.includes("audio")
          ) {
            console.log("[patient-join-client] mic permission blocked", {
              blockedMedia: evt.blockedMedia,
            });
            setMicBlocked(true);
          }
        });

        await frame.join({ url: dailyArgs.roomUrl, token: dailyArgs.meetingToken });
      } catch (err) {
        console.error("[patient-join-client] Daily mount error", err);
        if (!cancelled) {
          setError("Couldn't connect to the video call. Please try again.");
          setState("error");
          setDailyArgs(null);
        }
      }
    })();

    return () => {
      cancelled = true;
      const frame = frameRef.current;
      if (frame) {
        frameRef.current = null;
        // destroy() returns a promise; we don't await — React unmount
        // is synchronous and the call cleanup is best-effort.
        void frame.destroy().catch(() => {
          /* swallow — frame may already be torn down */
        });
      }
    };
    // CRITICAL: depend on dailyArgs ONLY, not [state, dailyArgs].
    // setState("in-call") on 'joined-meeting' must NOT re-run this
    // effect — see the v5 mirror comment above the effect body.
  }, [dailyArgs]);

  // Cache the Daily room URL + meeting token between consent click and
  // admit. POST /api/consultation/join records consent + joined_at AND
  // mints a 90-min Daily token in one shot; we hold the token in
  // state while the patient sits in the Sanocare waiting room and
  // hand it to the Daily mount the moment the doctor admits.
  //
  // The token cache is non-critical — if it's missing when admit
  // lands (page refresh between consent and admit, etc.), mintAndJoin
  // fetches a fresh one. Worst case is a single extra round-trip,
  // never a stuck UI.
  const [cachedDailyArgs, setCachedDailyArgs] = useState<{
    roomUrl: string;
    meetingToken: string;
  } | null>(null);

  /** Shared join-fetch — POSTs /api/consultation/join and returns the
   *  room URL + token, or throws / sets state="error". */
  const fetchJoinArgs = useCallback(async (): Promise<
    { roomUrl: string; meetingToken: string } | null
  > => {
    try {
      const res = await fetch(`/api/consultation/join/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.room_url || !data?.meeting_token) {
        setError(
          data?.error ??
            "Couldn't start your consultation. Please try again or call ops.",
        );
        setState("error");
        return null;
      }
      return { roomUrl: data.room_url, meetingToken: data.meeting_token };
    } catch (err) {
      console.error("[patient-join] fetch error", err);
      setError("Network error. Please try again.");
      setState("error");
      return null;
    }
  }, [token]);

  /** Consent click: record consent + joined_at, cache the token,
   *  transition to Sanocare waiting room. */
  const handleConsentSubmit = async () => {
    if (!consented) {
      setError("Please tick the consent box before joining.");
      return;
    }
    setError(null);

    // If the doctor already admitted before the patient even reached
    // this screen (rare: doctor saw an earlier-tap joined_at and
    // admitted instantly), skip the waiting-room state and go
    // straight to joining.
    if (admittedAt) {
      setState("joining");
      const args = await fetchJoinArgs();
      if (args) {
        setCachedDailyArgs(args);
        setDailyArgs(args);
      }
      return;
    }

    // Normal flow: consent → waiting-room. We mint the Daily token
    // upfront so the post-admit transition is instant; the token
    // sits cached until admittedAt flips.
    setState("waiting-room");
    const args = await fetchJoinArgs();
    if (args) setCachedDailyArgs(args);
  };

  /** Called from the admit-detection useEffect when admittedAt flips
   *  non-null while we're in waiting-room. Uses cached args if
   *  present; otherwise fetches fresh.
   *
   *  Returns void; setDailyArgs triggers the existing Daily mount
   *  effect (dependency on dailyArgs only — see the long comment
   *  above that effect for why we don't depend on state). */
  const mintAndJoin = useCallback(async () => {
    setState("joining");
    if (cachedDailyArgs) {
      setDailyArgs(cachedDailyArgs);
      return;
    }
    const args = await fetchJoinArgs();
    if (args) {
      setCachedDailyArgs(args);
      setDailyArgs(args);
    }
  }, [cachedDailyArgs, fetchJoinArgs]);

  // ===== Admit-state reactions =====
  //
  // (1) admittedAt becomes non-null while waiting → mount Daily.
  // (2) admittedAt becomes null while joining/in-call → unmount Daily
  //     and re-show the Sanocare waiting screen (doctor clicked Send
  //     to Waiting). The dailyArgs=null trigger lets the existing
  //     mount effect's cleanup destroy the frame.
  // (3) endedAt becomes non-null → unmount Daily and show the
  //     post-consult screen (doctor clicked Mark Attended). Takes
  //     precedence over admit transitions.
  useEffect(() => {
    // Mark Attended path — takes precedence.
    if (endedAt && state !== "ended" && state !== "error") {
      setDailyArgs(null);
      setState("ended");
      return;
    }
    // Send to Waiting path — admit cleared while in active call.
    if (
      !admittedAt &&
      (state === "joining" || state === "in-call")
    ) {
      setDailyArgs(null);
      setState("waiting-room");
      return;
    }
    // Admit lands path — patient was waiting, now goes to joining.
    if (admittedAt && state === "waiting-room") {
      void mintAndJoin();
    }
    // mintAndJoin is memoised; safe to depend on. state included
    // because the guards above branch on it.
  }, [admittedAt, endedAt, state, mintAndJoin]);

  /** Cancel from waiting room — route to / with a session-storage flag
   *  so the home page can surface a toast. No booking-state mutation
   *  per the v1 brief. The flag is read on the home page side; if no
   *  toast surface exists yet, the flag harmlessly persists until the
   *  next pageview cleans it up. */
  const handleCancelWait = () => {
    try {
      sessionStorage.setItem(
        "sanocare:waiting-room-cancel",
        JSON.stringify({ at: new Date().toISOString() }),
      );
    } catch {
      /* sessionStorage may be unavailable (private mode); non-fatal. */
    }
    window.location.assign("/");
  };

  const handleRetry = () => {
    setError(null);
    setDailyArgs(null);
    setCachedDailyArgs(null);
    setState("consent");
  };

  // ===== Render =====

  if (state === "in-call" || state === "joining") {
    const isInCall = state === "in-call";
    return (
      // v6 layout: while "joining" (consent done, Daily prejoin /
      // device test loading) we keep the small card with the
      // waiting-room context above — useful so the patient knows
      // what's happening and can read the doctor / booking info.
      // The moment 'joined-meeting' fires and state flips to
      // "in-call", the iframe wrapper expands to a fullscreen fixed
      // overlay (z-50, 100dvh) — the patient needs the doctor's
      // face large enough to read expressions and hand gestures.
      // The pre-call status text is hidden via the `hidden` class
      // (NOT removed from the JSX tree) so React's reconciliation
      // keeps the iframe-wrapper div as the same DOM node across
      // the transition. If we conditionally REMOVED siblings, React
      // could shift positions and remount the wrapper — which would
      // detach Daily's iframe from the DOM mid-call. The wrapper's
      // own className flip is in-place (same DOM node, updated
      // attributes), so the <div ref={containerRef}> stays and the
      // Daily iframe inside it keeps its parent.
      <div className={isInCall ? "" : "space-y-4"}>
        <div
          className={
            "text-xs text-text-secondary flex items-start gap-2" +
            (isInCall ? " hidden" : "")
          }
        >
          <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            You&apos;re in your doctor&apos;s waiting room. They&apos;ll admit
            you shortly. Use the in-call controls to mute, turn off video, or
            leave.
          </span>
        </div>
        <div
          // joining: small card (16:10 aspect, min 320px) so the
          // patient sees the Daily prejoin / device-test UI inline
          // alongside the consent context.
          // in-call: fixed fullscreen — `inset-0` covers the
          // viewport, `h-[100dvh]` uses the dynamic viewport height
          // so iOS Safari's URL bar doesn't bite into the visible
          // area (100vh on Safari includes the URL-bar area; 100dvh
          // is the actually-visible height). bg-slate-900 fills any
          // gap if Daily's iframe has letterboxing.
          className={
            isInCall
              ? "fixed inset-0 z-50 w-screen h-[100dvh] bg-slate-900"
              : "relative w-full bg-slate-900 rounded-2xl overflow-hidden"
          }
          style={
            isInCall ? undefined : { aspectRatio: "16 / 10", minHeight: "320px" }
          }
        >
          <div ref={containerRef} className="absolute inset-0" />
          {/* T52: mic-permission banner. Sits above the Daily iframe
              wrapper with absolute positioning so it overlays the
              top of the video area when in-call (where mic errors
              are most likely to surface), and inside the joining
              card otherwise. z-20 > the Sanocare badge's z-10 so
              it stacks on top when both are visible. `pointer-events-
              auto` so the × is clickable; the badge sibling stays
              pointer-events-none. */}
          {micBlocked && (
            <div className="absolute top-2 left-2 right-2 z-20 pointer-events-auto">
              <MicBlockedBanner onDismiss={() => setMicBlocked(false)} />
            </div>
          )}
          {/* v6.1: Sanocare brand badge anchored top-left of the
              iframe wrapper. Renders across both joining (small
              card view) and in-call (fullscreen view) — the
              `position: absolute` anchors to whichever wrapper
              shape is active. pointer-events-none ensures Daily's
              UI (mute/camera/leave/fullscreen) stays clickable.
              Safe area on the patient side: Daily renders prejoin
              middle-top, in-call header middle-top, control bar
              spans the bottom — top-left is clean. */}
          <div className="absolute top-3 left-3 z-10 pointer-events-none inline-flex items-center gap-1.5 bg-white/90 backdrop-blur-sm rounded-md px-2.5 py-1.5 shadow-sm">
            <Image
              src="/logo.svg"
              alt=""
              width={20}
              height={20}
              className="w-5 h-5 sm:w-6 sm:h-6"
              priority={false}
            />
            <span className="text-xs sm:text-sm font-semibold text-slate-900">
              Sanocare
            </span>
          </div>
          {state === "joining" && (
            // pointer-events-none is CRITICAL — without it, this
            // overlay covers Daily's in-iframe Join button on the
            // prejoin screen and the patient tap doesn't reach it
            // (founder reproduced on mobile pre-v5: Join button
            // visible through the dim, tapping does nothing).
            //
            // Only rendered while state === "joining" — once Daily
            // fires 'joined-meeting' the state guard removes it,
            // leaving the iframe (now fullscreen via the wrapper
            // className flip above) as the sole content. Mirror of
            // the v3 doctor-side fix in DutyRoomEmbed.tsx.
            <div className="absolute inset-0 flex items-center justify-center text-white text-sm gap-2 pointer-events-none">
              <Loader2 className="w-4 h-4 animate-spin" />
              Connecting to your consultation…
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== Sanocare-native waiting room =====
  // Task #43: the gate that replaces Daily's generic prejoin/knock for
  // the patient. Sits between consent and the Daily mount. The
  // useSessionAdmitState hook above watches doctor_admitted_at; when
  // it flips non-null, the [admittedAt, state] effect calls
  // mintAndJoin() which transitions us into "joining".
  if (state === "waiting-room") {
    const scheduled = new Date(scheduledAt);
    const scheduledLabel = Number.isFinite(scheduled.getTime())
      ? scheduled.toLocaleString("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : null;
    // "Send to Waiting" re-entry: the patient was already in-call and
    // the doctor pushed them back. M031: wasEverAdmitted is the
    // server-derived signal (true iff consultation_sessions.
    // first_admitted_at IS NOT NULL) — survives page refresh and
    // device switch, unlike the previous cachedDailyArgs-presence
    // heuristic which fired immediately after consent because the
    // token mint runs upfront.
    const isBriefHold = wasEverAdmitted;
    return (
      <div className="space-y-5">
        <div className="rounded-2xl bg-gradient-to-br from-sky-50 to-blue-50 border border-sky-200 px-6 py-7 text-center">
          {/* Doctor avatar — we don't have a real photo URL surface yet,
              so a tinted Stethoscope sits inside a pulsing dot. Pure
              CSS animation; no JS work per second. */}
          <div className="relative w-20 h-20 mx-auto mb-4">
            <div className="absolute inset-0 rounded-full bg-sky-200 animate-ping opacity-60" />
            <div className="relative w-20 h-20 rounded-full bg-white border-2 border-sky-300 inline-flex items-center justify-center">
              <Stethoscope className="w-9 h-9 text-sky-700" />
            </div>
          </div>
          <div className="font-semibold text-slate-900 text-lg">
            Dr {doctorFullName}
          </div>
          {doctorQualification && (
            <div className="text-sm text-slate-600 mt-0.5">
              {doctorQualification}
            </div>
          )}
          <div className="text-sm text-slate-700 mt-4">
            {isBriefHold
              ? `Dr ${doctorFullName.split(" ")[0]} stepped out for a moment. They'll bring you back in shortly.`
              : `Dr ${doctorFullName.split(" ")[0]} will admit you shortly.`}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {isBriefHold
              ? "Please keep this tab open — your call will resume automatically."
              : "Average wait time 2–3 minutes."}
          </div>
          {scheduledLabel && !isBriefHold && (
            <div className="text-[11px] font-mono text-slate-500 mt-4 inline-flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              {scheduledLabel}
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 text-rose-700 text-sm bg-rose-50 border border-rose-200 rounded-lg p-3">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        <div className="text-center">
          <button
            type="button"
            onClick={handleCancelWait}
            className="text-sm text-slate-500 hover:text-slate-900 underline decoration-slate-300 hover:decoration-slate-900"
          >
            Cancel and return
          </button>
        </div>

        <div className="text-[11px] text-slate-400 text-center flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3 h-3" />
          Don&apos;t close this tab — we&apos;ll move you into the consultation
          automatically.
        </div>
      </div>
    );
  }

  if (state === "ended") {
    // Two ways we landed here:
    //   (a) Doctor clicked Mark Attended → endedAt is non-null. The
    //       consult is formally over; "Re-join" is misleading and we
    //       hide it (the doctor's Mark Attended is intentional).
    //   (b) Patient hit Leave inside Daily → endedAt is still null,
    //       just a soft client-side state. "Re-join the call" reopens
    //       the path (mints a fresh token, lands in waiting-room,
    //       admit-state polling will resume).
    const formallyAttended = endedAt != null;
    return (
      <div className="space-y-4">
        <div className="rounded-xl border bg-emerald-50 border-emerald-200 text-emerald-900 p-4">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold mb-1">
                {formallyAttended
                  ? "Consultation complete."
                  : "Consultation ended."}
              </div>
              <div className="text-sm">
                {formallyAttended
                  ? `Dr ${doctorFullName.split(" ")[0]} has marked your consultation attended. Your prescription (if any) will arrive on WhatsApp shortly. You can close this tab.`
                  : "Your doctor's notes and prescription (if any) are with ops — you'll get them on WhatsApp shortly."}
              </div>
            </div>
          </div>
        </div>
        {!formallyAttended && (
          <button
            type="button"
            onClick={handleRetry}
            className="text-sm text-text-secondary hover:text-primary"
          >
            Re-join the call
          </button>
        )}
      </div>
    );
  }

  // state === "consent" or "error"
  return (
    <div className="space-y-5">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={consented}
          onChange={(e) => setConsented(e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded border-slate-300 accent-primary"
        />
        <span className="text-sm text-text-main">
          <span className="font-medium">I consent to this teleconsultation.</span>{" "}
          I understand the doctor will consult me remotely over video, the
          consultation will follow Indian medical practice guidelines, and the
          doctor may issue medical advice or a prescription based on this
          remote interaction.
        </span>
      </label>

      {error && (
        <div className="flex items-start gap-2 text-rose-700 text-sm bg-rose-50 border border-rose-200 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleConsentSubmit}
        disabled={!consented}
        className="w-full inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
      >
        <Video className="w-5 h-5" />
        Join consultation
      </button>

      <div className="flex items-start gap-2 text-xs text-text-secondary">
        <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          You&apos;ll join a private video room hosted by Sanocare. Your
          doctor admits one patient at a time — if they&apos;re still with
          another patient, please wait. The call runs in your browser; no app
          needed.
          {patientName ? ` Your name will appear as "${patientName}".` : ""}
        </span>
      </div>
    </div>
  );
}
