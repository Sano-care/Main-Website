"use client";

import { useCallback, useEffect, useState } from "react";
import { formatIST } from "@/lib/time/formatIST";

// T65 Phase 2B C5b — Attendance tab (read-only).
//
// Date-range control (last-N-days, 30 default) → GET .../attendance?days=.
// Table: date / clock-in / clock-out / hours worked / ping count.

type AttendanceRow = {
  id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  hours_worked: number | null;
  is_open: boolean;
  ping_count: number;
};

type Resp = { days: number; rows: AttendanceRow[] };

const DAY_OPTIONS = [7, 14, 30, 60, 90];

function hoursLabel(h: number | null, open: boolean): string {
  if (h == null) return "—";
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  const base = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  return open ? `${base} (open)` : base;
}

export function AttendanceTab({ medicId }: { medicId: string }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/ops/medics/${medicId}/attendance?days=${days}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(`Could not load attendance: ${body.error ?? res.statusText}`);
        return;
      }
      setData((await res.json()) as Resp);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load attendance.");
    } finally {
      setLoading(false);
    }
  }, [medicId, days]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-4">
      <label className="inline-flex items-center gap-2 text-sm">
        <span className="text-slate-500">Range</span>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        >
          {DAY_OPTIONS.map((d) => (
            <option key={d} value={d}>
              Last {d} days
            </option>
          ))}
        </select>
      </label>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {err && <div className="px-6 py-4 text-sm text-red-600">{err}</div>}
        {loading && !data ? (
          <div className="px-6 py-8 text-center text-sm text-slate-500">
            Loading attendance…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-slate-500">
            No attendance records yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left">
                  <Th>Date</Th>
                  <Th>Clock in</Th>
                  <Th>Clock out</Th>
                  <Th className="text-right">Hours</Th>
                  <Th className="text-right">Pings</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {formatIST(r.clock_in_at, "date")}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {formatIST(r.clock_in_at, "time")}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {r.clock_out_at ? formatIST(r.clock_out_at, "time") : "—"}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-slate-900">
                      {hoursLabel(r.hours_worked, r.is_open)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-mono text-slate-700">
                      {r.ping_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-slate-500 ${className}`}
    >
      {children}
    </th>
  );
}
