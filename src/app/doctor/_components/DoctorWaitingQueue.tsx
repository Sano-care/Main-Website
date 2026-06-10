import Link from "next/link";
import { Video, Clock, CheckCircle2, AlertCircle, FileText } from "lucide-react";
import type { DoctorWaitingSession } from "../_lib/doctorData";
import { formatIST } from "@/lib/time/formatIST";

/**
 * Renders the doctor's Duty Room queue. C2 read-only — the doctor uses
 * the Enter Duty Room button (further down the home page) to actually
 * open Zoom; this card just shows them what's coming and whether each
 * patient has tapped their WhatsApp link yet.
 *
 * No "Mark complete" affordance on the doctor side in C2 — ops closes
 * the booking via /ops/bookings/[id] after the consult, which is what
 * fires M4's earning trigger. Doctor-side completion arrives in a
 * later phase if ops asks for it.
 */
export function DoctorWaitingQueue({
  sessions,
  dutyRoomReady,
}: {
  sessions: DoctorWaitingSession[];
  dutyRoomReady: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-slate-100 flex items-baseline justify-between">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
          Waiting room
        </div>
        <div className="text-xs text-slate-500">
          {sessions.length === 0
            ? "No upcoming consults"
            : `${sessions.length} upcoming`}
        </div>
      </div>

      {!dutyRoomReady && (
        <div className="px-6 py-3 bg-amber-50 border-b border-amber-200 flex items-start gap-2 text-amber-900 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Your Duty Room URL isn&apos;t set up yet, so patients can&apos;t join.
            Contact ops or set it up from your profile.
          </span>
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="px-6 py-6 text-center text-sm text-slate-500">
          You don&apos;t have any teleconsultations scheduled. When ops books
          you on one, it&apos;ll show up here — and the patient will get a
          WhatsApp link to join your Duty Room.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {sessions.map((s) => {
            const when = new Date(s.scheduled_at);
            const clicked = s.patient_clicked_link_at != null;
            const consented = s.teleconsult_consent === true;
            return (
              <li
                key={s.id}
                className="px-6 py-4 flex items-start justify-between gap-4 hover:bg-slate-50"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-900 truncate">
                    {s.patient_name ?? "Patient (name not on file)"}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatIST(when)}
                    </span>
                    <span className="font-mono uppercase text-[10px] tracking-wider bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                      {s.modality === "teleconsultation" ? "telecon" : "vc home"}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1.5 text-xs">
                  {consented ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Consent recorded
                    </span>
                  ) : clicked ? (
                    <span className="inline-flex items-center gap-1 text-sky-700">
                      <Video className="w-3.5 h-3.5" />
                      Link opened
                    </span>
                  ) : (
                    <span className="text-slate-400">Awaiting patient</span>
                  )}
                  {/* C2-Rx: jump straight into the composer for this
                      consult. Open a new draft if none exists, otherwise
                      continue the existing one. The composer route resolves
                      idempotency itself. */}
                  <Link
                    href={`/doctor/sessions/${s.id}/prescribe`}
                    className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-md"
                  >
                    <FileText className="w-3 h-3" /> Prescribe
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="px-6 py-3 bg-slate-50 text-[11px] text-slate-500 border-t border-slate-100">
        Patients knock to join your Duty Room — admit them one at a time
        from inside the call. The room runs inside Sanocare; no external
        app needed.
      </div>
    </div>
  );
}
