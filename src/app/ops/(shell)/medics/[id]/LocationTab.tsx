"use client";

import { useCallback, useEffect, useState } from "react";
import { formatIST } from "@/lib/time/formatIST";

// T65 Phase 2B C5b — Location tab (read-only).
//
// Date picker (today default) → GET .../location-summary?date=. Summary card
// (ping count, first/last ping, coverage %) + last-50 pings table. No Maps
// embed (deferred to Phase 3 per locked dispatch).

type Summary = {
  ping_count: number;
  first_ping_at: string | null;
  last_ping_at: string | null;
  coverage_pct: number | null;
  clocked_in_minutes: number;
};

type Ping = {
  id: string;
  pinged_at: string;
  lat: number;
  lng: number;
  battery_pct: number | null;
  accuracy_m: number | null;
};

type Resp = { date: string; summary: Summary; pings: Ping[] };

function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function LocationTab({ medicId }: { medicId: string }) {
  const [date, setDate] = useState(istToday());
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/ops/medics/${medicId}/location-summary?date=${date}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(`Could not load location data: ${body.error ?? res.statusText}`);
        return;
      }
      setData((await res.json()) as Resp);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load location data.");
    } finally {
      setLoading(false);
    }
  }, [medicId, date]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const summary = data?.summary;
  const pings = data?.pings ?? [];

  return (
    <div className="space-y-4">
      <label className="inline-flex items-center gap-2 text-sm">
        <span className="text-slate-500">Date</span>
        <input
          type="date"
          value={date}
          max={istToday()}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        />
      </label>

      {err && (
        <div className="bg-white border border-slate-200 rounded-2xl px-6 py-4 text-sm text-red-600">
          {err}
        </div>
      )}

      {/* Summary card */}
      <div className="bg-white border border-slate-200 rounded-2xl px-6 py-5">
        {loading && !data ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="Pings" value={summary ? String(summary.ping_count) : "—"} />
            <Stat
              label="Coverage"
              value={
                summary?.coverage_pct != null ? `${summary.coverage_pct}%` : "—"
              }
              hint={
                summary && summary.clocked_in_minutes > 0
                  ? `${summary.clocked_in_minutes} min on duty`
                  : "no on-duty time"
              }
            />
            <Stat
              label="First ping"
              value={summary?.first_ping_at ? formatIST(summary.first_ping_at, "time") : "—"}
            />
            <Stat
              label="Last ping"
              value={summary?.last_ping_at ? formatIST(summary.last_ping_at, "time") : "—"}
            />
          </div>
        )}
      </div>

      {/* Ping table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 text-[11px] font-mono uppercase tracking-wider text-slate-500">
          Last {pings.length} pings
        </div>
        {!loading && pings.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-slate-500">
            No location pings on this date.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left">
                  <Th>Time</Th>
                  <Th>Lat</Th>
                  <Th>Lng</Th>
                  <Th className="text-right">Battery</Th>
                </tr>
              </thead>
              <tbody>
                {pings.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-700">
                      {formatIST(p.pinged_at, "time")}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-600">
                      {p.lat.toFixed(6)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-600">
                      {p.lng.toFixed(6)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-600">
                      {p.battery_pct != null ? `${p.battery_pct}%` : "—"}
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

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
      {hint && <div className="text-xs text-slate-400">{hint}</div>}
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
