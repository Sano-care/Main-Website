import { Video, ExternalLink, AlertCircle } from "lucide-react";

/**
 * Enter Duty Room CTA. When the doctor has a duty_room_join_url set,
 * renders a link that opens the Zoom room in a new tab. When it's null
 * (Zoom room not provisioned yet by ops), renders a graceful fallback
 * panel explaining the state.
 *
 * No Zoom REST API integration in C1 — this is literally the stored URL,
 * opened in a new tab. C2 takes over for meeting / waiting-room flow.
 */
export function EnterDutyRoomButton({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-amber-900">
            Your Duty Room isn&apos;t set up yet
          </div>
          <div className="text-xs text-amber-800 mt-1">
            Ops will paste your Zoom Personal Meeting Room link into your record.
            Once that&apos;s done, the &quot;Enter Duty Room&quot; button will show up here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-6 inline-flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold px-6 py-3 rounded-2xl transition-colors w-full sm:w-auto"
    >
      <Video className="w-5 h-5" />
      Enter Duty Room
      <ExternalLink className="w-4 h-4 opacity-70" />
    </a>
  );
}
