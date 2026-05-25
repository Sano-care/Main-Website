"use client";

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

  // ===== Mount Daily Prebuilt when args land =====
  useEffect(() => {
    if (state !== "joining" || !dailyArgs || !containerRef.current) return;

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
            showLeaveButton: true,
          },
        );

        frameRef.current = frame;

        frame.on("joined-meeting", () => {
          if (!cancelled) setState("in-call");
        });
        frame.on("left-meeting", () => {
          if (!cancelled) setState("ended");
        });
        frame.on("error", (e: unknown) => {
          console.error("[patient-join] Daily error event", e);
          if (!cancelled) {
            setError("The call disconnected unexpectedly. Please rejoin.");
            setState("error");
          }
        });

        await frame.join({ url: dailyArgs.roomUrl, token: dailyArgs.meetingToken });
      } catch (err) {
        console.error("[patient-join] Daily mount error", err);
        if (!cancelled) {
          setError("Couldn't connect to the video call. Please try again.");
          setState("error");
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
  }, [state, dailyArgs]);

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
    return (
      <div className="space-y-4">
        <div className="text-xs text-text-secondary flex items-start gap-2">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            You&apos;re in your doctor&apos;s waiting room. They&apos;ll admit
            you shortly. Use the in-call controls to mute, turn off video, or
            leave.
          </span>
        </div>
        <div
          // Square-ish aspect on mobile, 16:9 on desktop. Container holds
          // the Daily iframe (which positions absolutely inside).
          className="relative w-full bg-slate-900 rounded-2xl overflow-hidden"
          style={{ aspectRatio: "16 / 10", minHeight: "320px" }}
        >
          <div ref={containerRef} className="absolute inset-0" />
          {state === "joining" && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-sm gap-2">
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
