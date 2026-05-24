"use client";

import { useState } from "react";
import { Video, Loader2, AlertCircle, ShieldCheck } from "lucide-react";

/**
 * The interactive part of /c/[token]. Renders the NMC teleconsultation
 * consent checkbox + the Join button. On click, POSTs to
 * /api/consultation/join/[token] which records the consent + joined_at
 * and returns the doctor's PMI URL (server-vetted, so a tampered
 * pmiUrl on the client could not bypass the consent record). The
 * client then navigates the browser to that URL.
 *
 * If teleconsult_consent was already recorded true on a prior tap
 * (the link is reusable), the consent checkbox is shown pre-ticked
 * and the patient can re-join directly.
 */
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoin = async () => {
    if (!consented) {
      setError("Please tick the consent box before joining.");
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      const res = await fetch(`/api/consultation/join/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.redirect_url) {
        setError(
          data?.error ??
            "Couldn't start your consultation. Please try again or call ops.",
        );
        return;
      }
      // Hand the browser to Zoom. window.location.assign keeps the
      // back-button history sane (vs replace), so the patient can
      // return to /c/[token] if they need to re-join after the call.
      window.location.assign(data.redirect_url);
    } catch (err) {
      console.error("[patient-join] error", err);
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* NMC teleconsultation consent — required before join. */}
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={consented}
          onChange={(e) => setConsented(e.target.checked)}
          disabled={isLoading}
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
        disabled={!consented || isLoading}
        className="w-full inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Joining…
          </>
        ) : (
          <>
            <Video className="w-5 h-5" />
            Join consultation
          </>
        )}
      </button>

      <div className="flex items-start gap-2 text-xs text-text-secondary">
        <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          You&apos;ll join a private Zoom waiting room. Your doctor admits one
          patient at a time. If they&apos;re still with another patient, please
          wait — they&apos;ll let you in shortly.
          {patientName ? ` Make sure your name shows as "${patientName}" in Zoom.` : ""}
        </span>
      </div>
    </div>
  );
}
