"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  Video,
  ExternalLink,
  AlertCircle,
  Loader2,
  X,
  ShieldCheck,
  FileText,
} from "lucide-react";
import { RxComposerDrawer } from "./RxComposerDrawer";

/**
 * Doctor-side Daily Prebuilt embed.
 *
 * Replaces C2's EnterDutyRoomButton (which opened the Zoom PMI URL in
 * a new tab). C2-V keeps the doctor on /doctor and embeds the call
 * inline — overlay covers the page when active; leaving the call
 * dismisses the overlay and returns the doctor to the queue.
 *
 * Three visual states:
 *   1. No Duty Room URL yet → amber "not set up" notice (admin needs
 *      to provision via /ops/doctors/[id]).
 *   2. URL present, not in call → "Open Duty Room" button + a
 *      reminder that the call lives inside Sanocare (no external app).
 *   3. In call → fullscreen overlay with Daily Prebuilt iframe and
 *      a close button (the iframe also has its own Leave control).
 *
 * Owner privileges (admit/deny knockers, screen share, mute others)
 * come from the meeting token minted server-side at
 * /api/doctor/duty-room/start — token is the auth, Daily Prebuilt
 * surfaces the admit UI automatically when participants knock.
 */

type EmbedState = "idle" | "starting" | "in-call" | "ended" | "error";

type DailyFrameLike = {
  join: (opts: { url: string; token: string }) => Promise<unknown>;
  destroy: () => Promise<unknown>;
  on: (event: string, handler: (e: unknown) => void) => unknown;
};

export function DutyRoomEmbed({ url }: { url: string | null }) {
  const [state, setState] = useState<EmbedState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dailyArgs, setDailyArgs] = useState<{
    roomUrl: string;
    meetingToken: string;
  } | null>(null);
  // v3: in-call Rx drawer state. When open, the iframe wrapper shrinks
  // to ~60% width (F1 sign-off) and the drawer mounts as a 40% flex
  // sibling on the right. Daily Prebuilt re-flows on container resize
  // without an explicit API call (verified on v6.1's patient
  // fullscreen toggle).
  const [rxDrawerOpen, setRxDrawerOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<DailyFrameLike | null>(null);

  // No safety-timeout. v1 had a 10s setTimeout that flipped a state
  // flag; v2 post-mortem flagged it suspect. v4 makes it unnecessary:
  // the overlay below has pointer-events-none, so Daily's in-iframe
  // Join button on the prejoin screen is clickable through the dim.
  // Doctor clicks Join → 'joined-meeting' fires → state flips to
  // "in-call" → overlay JSX is conditionally removed via the state
  // guard. No timer needed.

  // Mount Daily Prebuilt EXACTLY ONCE per dailyArgs lifecycle.
  //
  // v3 post-mortem (founder's Chrome MCP trace): the v1/v3 dep array
  // was `[state, dailyArgs]`. When 'joined-meeting' fired, the handler
  // called setState("in-call"); the state change re-ran THIS effect,
  // which executed its cleanup function (calling frame.destroy()),
  // then attempted to createFrame + join again with the SAME (now
  // already-used) meeting token. That second join failed in the
  // catch block, which set state="error" → modal closed, error
  // banner shown. The trace showed `joined-meeting` firing
  // successfully ONLY for the iframe to be torn down moments later
  // — exactly this remount cycle.
  //
  // v4 fix: depend on `dailyArgs` only. The effect mounts when args
  // land, stays mounted across state transitions ("starting" →
  // "in-call"), and cleans up exactly when dailyArgs is cleared
  // (which happens on handleClose, on 'left-meeting', on 'error',
  // and on component unmount).
  useEffect(() => {
    if (!dailyArgs) return;
    if (!containerRef.current) return;

    let cancelled = false;
    (async () => {
      try {
        const mod = await import("@daily-co/daily-js");
        if (cancelled) return;
        const DailyIframe =
          (mod as { default?: unknown }).default ?? (mod as unknown);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Factory = DailyIframe as any;

        const frame: DailyFrameLike = Factory.createFrame(
          containerRef.current as HTMLElement,
          {
            iframeStyle: {
              position: "absolute",
              inset: "0",
              width: "100%",
              height: "100%",
              border: "0",
            },
            theme: {
              colors: {
                accent: "#1f6feb",
                accentText: "#ffffff",
                background: "#ffffff",
                backgroundAccent: "#f8fafc",
                baseText: "#0f172a",
                border: "#e2e8f0",
                mainAreaBg: "#0f172a",
                mainAreaBgAccent: "#1e293b",
                mainAreaText: "#ffffff",
                supportiveText: "#94a3b8",
              },
            },
            // Daily Prebuilt UX flags. NOTE: we deliberately do NOT
            // try to skip Daily's prejoin UI here.
            //
            //   v1 attempted `showPrejoinUI: false` — that property
            //   does not exist in DailyCallOptions in daily-js
            //   0.90.0; it was silently ignored.
            //
            //   v2 attempted token-level `enable_prejoin_ui: false`
            //   on the meeting-token mint — that property is NOT in
            //   the POST /meeting-tokens request schema (it lives
            //   only inside DailyRoomInfo.tokenConfig as the room's
            //   default-token-config readback). Daily silently
            //   accepted it, stamped `epui:false` as a no-op JWT
            //   claim, and the SDK then hung at
            //   `iframe-ready-for-launch-config` for ~25s before
            //   surfacing an error.
            //
            // For now: accept Daily's prejoin. The doctor clicks
            // Join inside the iframe; the overlay below has
            // pointer-events-none so the click passes through. Auto-
            // join can be revisited via a daily-js bump or a
            // room-level enable_prejoin_ui PATCH in a follow-up.
            showLeaveButton: true,
            showFullscreenButton: true,
            showLocalVideo: true,
          },
        );

        frameRef.current = frame;

        frame.on("joined-meeting", () => {
          // Telemetry (kept past v4 ship): the v3 trace showed this
          // event firing successfully ONLY for the iframe to be torn
          // down moments later by the buggy `state`-in-dep-array
          // remount. If a future regression breaks this path again,
          // the log line below pins it immediately.
          console.log("[duty-room-embed] joined-meeting", {
            cancelled,
            frameAlive: !!frameRef.current,
          });
          if (!cancelled) setState("in-call");
        });
        frame.on("left-meeting", () => {
          console.log("[duty-room-embed] left-meeting", { cancelled });
          if (!cancelled) {
            setState("ended");
            // Clear dailyArgs so the effect's cleanup runs and
            // destroys the frame (the iframe's container is removed
            // from the DOM when render falls through to the "ended"
            // interstitial; without this, frameRef.current would
            // dangle).
            setDailyArgs(null);
          }
        });
        frame.on("error", (e: unknown) => {
          console.error("[duty-room-embed] Daily error", e);
          if (!cancelled) {
            setError("The call disconnected. You can re-open the Duty Room.");
            setState("error");
            // Same reasoning as left-meeting — clear dailyArgs so the
            // cleanup destroys the frame promptly. Without it, a
            // subsequent handleOpen() would create a second frame
            // and we'd leak the first.
            setDailyArgs(null);
          }
        });

        await frame.join({ url: dailyArgs.roomUrl, token: dailyArgs.meetingToken });
      } catch (err) {
        console.error("[duty-room-embed] Daily mount failed", err);
        if (!cancelled) {
          setError("Couldn't open your Duty Room. Try again in a moment.");
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
        void frame.destroy().catch(() => {
          /* swallow */
        });
      }
    };
    // CRITICAL: depend on dailyArgs ONLY, not [state, dailyArgs].
    // setState("in-call") on 'joined-meeting' must NOT re-run this
    // effect — see the v3-post-mortem block above the effect body.
  }, [dailyArgs]);

  const handleOpen = async () => {
    setError(null);
    setState("starting");
    try {
      const res = await fetch("/api/doctor/duty-room/start", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.room_url || !data?.meeting_token) {
        setError(data?.error ?? "Couldn't open your Duty Room.");
        setState("error");
        return;
      }
      setDailyArgs({ roomUrl: data.room_url, meetingToken: data.meeting_token });
      // useEffect mounts the iframe.
    } catch (err) {
      console.error("[duty-room-embed] fetch error", err);
      setError("Network error. Please try again.");
      setState("error");
    }
  };

  const handleClose = () => {
    // Manual close — destroy via the cleanup in useEffect when we move
    // out of in-call.
    setState("idle");
    setDailyArgs(null);
  };

  // ===== 1. No URL configured =====
  if (!url) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-amber-900">
            Your Duty Room isn&apos;t set up yet
          </div>
          <div className="text-xs text-amber-800 mt-1">
            Ops will provision your Duty Room from /ops/doctors. Once
            that&apos;s done, the &quot;Open Duty Room&quot; button will show
            up here.
          </div>
        </div>
      </div>
    );
  }

  // ===== 3. In call (overlay) =====
  if (state === "starting" || state === "in-call") {
    return (
      <>
        <div className="mb-6 inline-flex items-center justify-center gap-2 bg-slate-200 text-slate-600 font-semibold px-6 py-3 rounded-2xl w-full sm:w-auto">
          <Loader2 className="w-5 h-5 animate-spin" />
          Duty Room is open in the overlay…
        </div>
        <div className="fixed inset-0 z-50 bg-slate-900/90 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
          {/* v3 F1: the modal body is a horizontal flex container.
              Iframe wrapper takes 60% when the Rx drawer is open,
              100% otherwise. Daily Prebuilt re-flows on container
              resize without an explicit API call (verified on v6.1's
              patient fullscreen toggle — same mechanism).
              max-w-7xl up from v6's max-w-6xl to keep the 60/40
              split readable on 1366px-class displays. */}
          <div className="relative w-full h-full max-w-7xl bg-slate-900 rounded-2xl overflow-hidden shadow-2xl flex">
            {/* Iframe wrapper — left side */}
            <div
              className={
                rxDrawerOpen
                  ? "relative flex-1 min-w-0"
                  : "relative w-full"
              }
            >
              <div ref={containerRef} className="absolute inset-0" />
              {/* v6.1: Sanocare brand badge anchored top-left of the
                  iframe wrapper. pointer-events-none so Daily's UI
                  (mute, camera, leave) is never blocked. z-10 stacks
                  above the iframe but below modal-level chrome. The
                  Close button at top-3 right-3 sits at the same
                  z-level on the opposite corner — they never overlap.
                  Safe area: Daily's prejoin "Are you ready to join?"
                  lives middle-top, in-call header "Waiting for
                  others" lives middle-top, the bottom control bar
                  spans the bottom; top-left is clean. */}
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
              {state === "starting" && (
                // pointer-events-none is CRITICAL — without it, this
                // overlay covers Daily's in-iframe Join button on the
                // prejoin screen and the doctor can't proceed
                // ('joined-meeting' never fires; everything wedges).
                // With pointer-events-none, the dim is visual only;
                // clicks pass through to Daily's prejoin Join control.
                // Once Daily fires 'joined-meeting', the handler above
                // flips state to "in-call", which conditionally removes
                // this overlay via the surrounding state guard. The
                // frame stays mounted across that transition because
                // the mount effect depends on dailyArgs only (v4 fix).
                <div className="absolute inset-0 flex items-center justify-center text-white text-sm gap-2 bg-slate-900/60 pointer-events-none">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Connecting to your Duty Room…
                </div>
              )}
              <button
                type="button"
                onClick={handleClose}
                className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 bg-slate-800/80 hover:bg-slate-700 text-white text-xs px-3 py-1.5 rounded-lg backdrop-blur"
                aria-label="Close Duty Room"
              >
                <X className="w-3.5 h-3.5" /> Close
              </button>

              {/* v3: floating Rx composer FAB. Only renders once we're
                  actually in-call (no prejoin distraction). Drawer is
                  exclusive — when open the FAB hides; closing the drawer
                  re-shows the FAB so doctor can reopen mid-consult. */}
              {state === "in-call" && !rxDrawerOpen && (
                <button
                  type="button"
                  onClick={() => setRxDrawerOpen(true)}
                  aria-label="Open Rx composer"
                  className="absolute bottom-6 right-6 z-[60] inline-flex items-center gap-2 bg-[#2B81FF] hover:bg-[#1E6BD6] text-white text-sm font-semibold px-4 py-3 rounded-full shadow-2xl ring-2 ring-white/30 transition-colors"
                >
                  <FileText className="w-5 h-5" />
                  Compose Rx
                </button>
              )}
            </div>

            {/* Drawer — right 40%; flex-sibling so iframe re-flows. */}
            {rxDrawerOpen && (
              <div className="relative w-[40%] min-w-[420px] max-w-[560px] h-full">
                <RxComposerDrawer
                  open={rxDrawerOpen}
                  onClose={() => setRxDrawerOpen(false)}
                />
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  // ===== End-of-call interstitial =====
  if (state === "ended") {
    return (
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-900">
              Duty Room closed.
            </div>
            <div className="text-xs text-slate-600 mt-1">
              Ops will close out the booking and post your earning. Re-open
              the room any time to take the next consult.
            </div>
          </div>
          <button
            type="button"
            onClick={handleOpen}
            className="inline-flex items-center gap-1.5 text-xs text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg"
          >
            <Video className="w-3.5 h-3.5" /> Re-open
          </button>
        </div>
      </div>
    );
  }

  // ===== 2. Idle (button) + error surface =====
  return (
    <div className="mb-6 space-y-3">
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold px-6 py-3 rounded-2xl transition-colors w-full sm:w-auto"
      >
        <Video className="w-5 h-5" />
        Open Duty Room
        <ExternalLink className="w-4 h-4 opacity-70" />
      </button>
      {error && (
        <div className="flex items-start gap-2 text-rose-700 text-sm bg-rose-50 border border-rose-200 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}
      <p className="text-[11px] text-slate-500">
        Your Duty Room opens inside Sanocare — no app to install. Patients
        knock; you admit them one at a time.
      </p>
    </div>
  );
}
