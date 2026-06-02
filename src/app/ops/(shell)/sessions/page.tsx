import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { getCurrentOpsUser } from "../../_lib/getCurrentOpsUser";

export const metadata: Metadata = {
  title: "Ops · Patient sessions",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/**
 * Patient session log — the answer to "did the consult happen?"
 *
 * Backed by the M032 view public.vw_patient_session_log which joins
 * bookings + customers + consultation_sessions + the patient
 * consultation_participants row + doctors. Three boolean signals per
 * session that ops cares about:
 *
 *   - joined_waiting_room       (cp.joined_at IS NOT NULL)
 *   - admitted_to_consultation  (cp.admitted_at IS NOT NULL)
 *   - attendance_status         ('attended' / 'not_attended')
 *
 * Phase 1 scope: render the last 24h. Filtering, pagination, csv
 * export, etc. all deferred to a follow-up. The view is read-only,
 * so this page is purely a SELECT against it.
 */

type SessionLogRow = {
  patient_id: string | null;
  patient_name: string | null;
  patient_phone: string | null;
  booking_id: string | null;
  payment_amount: number | null;
  payment_status: string | null;
  service_category: string | null;
  session_id: string | null;
  doctor_id: string | null;
  doctor_code: string | null;
  doctor_name: string | null;
  waiting_room_joined_at: string | null;
  joined_waiting_room: boolean | null;
  consultation_admitted_at: string | null;
  admitted_to_consultation: boolean | null;
  attendance_status: "not_attended" | "attended" | null;
  attendance_marked_at: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
};

const IST_FORMAT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function fmtIst(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return IST_FORMAT.format(d);
}

function SignalCell({ value }: { value: boolean | null }) {
  // Tri-state: true → green check, false → grey dash circle, null → red X.
  // The view emits null when the joined session simply doesn't exist
  // (non-teleconsult bookings — homecare / chronic / diagnostics rows
  // appear here because the FROM is bookings).
  if (value === true) {
    return <CheckCircle2 className="w-4 h-4 text-emerald-600 inline" />;
  }
  if (value === false) {
    return <Circle className="w-4 h-4 text-slate-300 inline" />;
  }
  return <XCircle className="w-4 h-4 text-slate-300 inline" />;
}

export default async function OpsSessionsPage() {
  // Gate. getCurrentOpsUser() redirects to /ops/login on no session
  // and /ops/no-access if the auth user isn't on ops_users.
  await getCurrentOpsUser();
  const supabase = await createOpsRSCClient();

  // Last 24h window. The view doesn't have a created_at — we filter
  // on scheduled_at as the canonical "when this booking's consult
  // was planned." Non-teleconsult bookings have a scheduled_at via
  // bookings.scheduled_for too (joined by booking_id), but the view
  // surfaces session-side scheduled_at. For bookings without a
  // session, scheduled_at is null → not in the window → row excluded.
  // That's acceptable for Phase 1 — the view is teleconsult-centric.
  const since = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("vw_patient_session_log")
    .select(
      "patient_id, patient_name, patient_phone, booking_id, payment_amount, payment_status, service_category, session_id, doctor_id, doctor_code, doctor_name, waiting_room_joined_at, joined_waiting_room, consultation_admitted_at, admitted_to_consultation, attendance_status, attendance_marked_at, scheduled_at, started_at, ended_at",
    )
    .gte("scheduled_at", since)
    .order("scheduled_at", { ascending: false })
    .limit(200);

  const rows = (data as SessionLogRow[] | null) ?? [];

  return (
    <div className="px-8 py-8">
      <div className="mb-6">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1">
          Operations
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Patient sessions</h1>
        <p className="text-sm text-slate-600 mt-1">
          Last 72 hours of teleconsult activity. Three signal columns —
          waiting-room join, consultation admit, attendance — surface
          whether each consult actually happened.
        </p>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-3 mb-4">
          Could not load sessions: {error.message}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-500">
            No sessions in the last 24 hours.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left">
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Booking · Patient
                </th>
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Doctor
                </th>
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Scheduled
                </th>
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500 text-center">
                  Waiting
                </th>
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500 text-center">
                  Admitted
                </th>
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500 text-center">
                  Attended
                </th>
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.session_id ?? r.booking_id ?? Math.random()} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs font-semibold text-slate-900">
                      {r.booking_id ?? "—"}
                    </div>
                    <div className="text-sm text-slate-900">
                      {r.patient_name ?? "—"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {r.patient_id && (
                        <span className="font-mono">{r.patient_id}</span>
                      )}
                      {r.patient_id && r.patient_phone && " · "}
                      {r.patient_phone}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {r.doctor_name ? (
                      <>
                        <div>{r.doctor_name}</div>
                        <div className="text-xs font-mono text-slate-500">
                          {r.doctor_code}
                        </div>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {fmtIst(r.scheduled_at)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <SignalCell value={r.joined_waiting_room} />
                    {r.waiting_room_joined_at && (
                      <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                        {fmtIst(r.waiting_room_joined_at).split(", ")[1] ?? ""}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <SignalCell value={r.admitted_to_consultation} />
                    {r.consultation_admitted_at && (
                      <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                        {fmtIst(r.consultation_admitted_at).split(", ")[1] ?? ""}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.attendance_status === "attended" ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                        attended
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        not attended
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-slate-900">
                    {r.payment_amount != null ? `₹${Number(r.payment_amount).toLocaleString("en-IN")}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[11px] text-slate-400 text-center mt-6">
        Source: <span className="font-mono">vw_patient_session_log</span> (M032).
        Page shows the last 72 hours.{" "}
        <Link href="/ops/bookings" className="underline">
          Switch to bookings →
        </Link>
      </p>
    </div>
  );
}
