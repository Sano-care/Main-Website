"use client";

import { AlertCircle, X } from "lucide-react";

// T52: surfaced when Daily emits a 'camera-error' with type='permissions'
// where blockedMedia includes 'audio' — the patient's mic permission was
// denied / revoked. Banner mounts above the iframe wrapper in
// PatientJoinClient. The actual mic-retry flow happens through Daily's
// own in-iframe mic icon (Daily Prebuilt owns the controls); our copy
// directs the patient there.
//
// Dismissible via the × affordance. No auto-hide wire — Daily Prebuilt
// keeps its own state of mic permission inside the iframe, and a
// 'track-started' subscription with local-audio filtering would be more
// than the founder's "5-line wire" budget for this PR. Patient hits the
// × once their mic is working.
//
// Styling matches the connection-status / waiting-room banner pattern
// already used in PatientJoinClient (rose-50 background, rose-200
// border, rose-700 icon — same triad as the existing error surface).

interface MicBlockedBannerProps {
  onDismiss: () => void;
}

export function MicBlockedBanner({ onDismiss }: MicBlockedBannerProps) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 text-rose-700 text-sm bg-rose-50 border border-rose-200 rounded-lg p-3 mb-3"
    >
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1">
        We couldn&apos;t access your microphone. Click the mic icon to retry.
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss microphone notice"
        className="shrink-0 -m-1 p-1 text-rose-700 hover:text-rose-900 rounded"
      >
        <X className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
