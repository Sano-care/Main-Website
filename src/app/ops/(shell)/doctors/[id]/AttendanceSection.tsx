"use client";

import { useState, useTransition } from "react";
import { AlertCircle, CalendarPlus, Undo2 } from "lucide-react";
import { markAttendance, undoAttendance } from "../actions";
import { formatIST } from "@/lib/time/formatIST";

type AttendanceRow = {
  id: string;
  work_date: string;
  is_present: boolean;
  overtime_hours: number | null;
  overtime_amount_paise: number | null;
  note: string | null;
  created_at: string;
};

/**
 * Attendance UI for a salaried doctor.
 *
 * Admins see the "Mark present" form + an Undo button on each present
 * row. Non-admins see the list read-only.
 *
 * Mark-present trigger does the heavy lifting (ledger reconcile); this
 * component just collects the form values and calls the server action.
 */
export function AttendanceSection({
  doctorId,
  attendance,
  isAdmin,
}: {
  doctorId: string;
  attendance: AttendanceRow[];
  isAdmin: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Track which row is currently undoing — disables that row's button
  // and prevents double-clicks.
  const [undoing, setUndoing] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  const submitMark = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      try {
        await markAttendance(formData);
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        setError(e instanceof Error ? e.message : "Could not mark attendance");
      }
    });
  };

  const submitUndo = (attendanceId: string) => {
    setError(null);
    setUndoing(attendanceId);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("attendance_id", attendanceId);
        await undoAttendance(formData);
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        setError(e instanceof Error ? e.message : "Could not undo attendance");
      } finally {
        setUndoing(null);
      }
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6">
      <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-3">
        Attendance · salaried doctors only
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-3 py-2 mb-4">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {isAdmin ? (
        <form action={submitMark} className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5 pb-5 border-b border-slate-100">
          <input type="hidden" name="doctor_id" value={doctorId} />
          <label className="block">
            <span className="block text-xs font-medium text-slate-700 mb-1">Date *</span>
            <input
              type="date"
              name="work_date"
              required
              defaultValue={today}
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-700 mb-1">
              Overtime hours
            </span>
            <input
              type="number"
              name="overtime_hours"
              step="0.25"
              min={0}
              placeholder="e.g. 1.5"
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-700 mb-1">
              Overtime amount (₹)
            </span>
            <input
              type="number"
              name="overtime_amount_rupees"
              step="any"
              min={0}
              placeholder="Auto from hours × rate, or type a flat ₹"
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            />
          </label>
          <label className="block sm:col-span-2 lg:col-span-3">
            <span className="block text-xs font-medium text-slate-700 mb-1">
              Note (optional)
            </span>
            <input
              type="text"
              name="note"
              placeholder="Anything to remember about this day"
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={isPending}
              className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors inline-flex items-center justify-center gap-2"
            >
              <CalendarPlus className="w-4 h-4" />
              {isPending ? "Marking…" : "Mark present"}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-xs text-slate-500 mb-4">
          Marking attendance is restricted to ops admins.
        </p>
      )}

      {attendance.length === 0 ? (
        <p className="text-sm text-slate-500">
          No attendance recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="pb-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">Date</th>
                <th className="pb-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">Present</th>
                <th className="pb-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">Overtime</th>
                <th className="pb-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">Note</th>
                {isAdmin && <th className="pb-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {attendance.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 text-slate-700 whitespace-nowrap">
                    {formatIST(a.work_date, "date")}
                  </td>
                  <td className="py-2">
                    {a.is_present ? (
                      <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-700">
                        present
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                        undone
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-xs text-slate-600 whitespace-nowrap">
                    {a.overtime_amount_paise && a.overtime_amount_paise > 0
                      ? `₹${(a.overtime_amount_paise / 100).toLocaleString("en-IN")}${a.overtime_hours ? ` (${a.overtime_hours} hrs)` : ""}`
                      : "—"}
                  </td>
                  <td className="py-2 text-xs text-slate-600 max-w-xs truncate">
                    {a.note ?? "—"}
                  </td>
                  {isAdmin && (
                    <td className="py-2 text-right">
                      {a.is_present && (
                        <button
                          type="button"
                          onClick={() => submitUndo(a.id)}
                          disabled={undoing === a.id}
                          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-rose-600 disabled:opacity-50"
                        >
                          <Undo2 className="w-3 h-3" />
                          {undoing === a.id ? "Undoing…" : "Undo"}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
