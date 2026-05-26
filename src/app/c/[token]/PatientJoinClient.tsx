"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Video, Loader2, AlertCircle, ShieldCheck, CheckCircle2 } from "lucide-react";

/**
 * The interactive part of /c/[token]. Renders the NMC teleconsultation
 * consent checkbox + the Join button. On click, POSTs to
 * /api/consultation/join/[token] which records the consent + joined_at
 * and returns a Daily room URL + a freshly-minted 90-minute non-owner
 * meeting token. The client then dynamic-imports @daily-co/daily-js,
 * mounts a Daily Prebuilt iframe, and joins the room with the token —
 * the patient stays on sanocare.in throughout.
 *
 * C2-V replaces C2's window.location.assign() redirect-out — the patient
 * never leaves the page; the call is embedded inline. Daily Prebuilt
 * renders its own knock UI (the patient waits for the doctor to admit)
 * and the in-call controls (mute, camera, leave).
 *
 * Lifecycle states surfaced in the UI:
 *   "consent"   — show consent checkbox + Join button (or "Join again"
 *                 if alreadyConsented). Pre-call.
 *   "joining"   — POST in flight or Daily SDK loading.
 *   "in-call"   — iframe mounted, Daily owns the UI.
 *   "ended"     — frame.on("left-meeting") fired; show "Call ended" +
 *                 "Need help?" footer.
 *   "error"     — fetch / mint / iframe error; show retry option.
 */
type ClientState = "consent" | "joining" | "in-call" | "ended" | "error";

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
}: {
  token: string;
  patientName: string | null;
  alreadyConsented: boolean;
}) {
  const [consented, setConsented] = useState(alreadyConsented);
  const [state, setState] = useState<ClientState>("consent");
  const [error, setError] = useState<string | null>(null);

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

  const handleJoin = async () => {
    if (!consented) {
      setError("Please tick the consent box before joining.");
      return;
    }
    setError(null);
    setState("joining");
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
        return;
      }
      setDailyArgs({ roomUrl: data.room_url, meetingToken: data.meeting_token });
      // The useEffect above will pick this up and mount the iframe.
    } catch (err) {
      console.error("[patient-join] fetch error", err);
      setError("Network error. Please try again.");
      setState("error");
    }
  };

  const handleRetry = () => {
    setError(null);
    setDailyArgs(null);
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

  if (state === "ended") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border bg-emerald-50 border-emerald-200 text-emerald-900 p-4">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold mb-1">Consultation ended.</div>
              <div className="text-sm">
                Your doctor&apos;s notes and prescription (if any) are with
                ops — you&apos;ll get them on WhatsApp shortly.
              </div>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRetry}
          className="text-sm text-text-secondary hover:text-primary"
        >
          Re-join the call
        </button>
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
        onClick={handleJoin}
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
