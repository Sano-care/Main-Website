"use client";

// The interactive /pulse/vitals surface: a Recent tab (readings newest-first,
// each row expandable to its note + exact IST stamp + delete) and a Trends tab
// (kind picker + rolling-window line chart with a min/avg/max summary). A
// sticky bottom bar opens the add-reading sheet; the whole surface re-pulls
// from the API after any add or delete so the list, chart and home tile agree.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  ChevronDown,
  Trash2,
  LineChart as LineChartIcon,
  ListChecks,
  Loader2,
} from "lucide-react";

import type { VitalKind } from "@/app/api/pulse/_lib/validation";
import { formatIST } from "@/lib/time/formatIST";
import { PulseStickyBar } from "../../_components/PulseStickyBar";
import { AddVitalSheet } from "../../_components/AddVitalSheet";
import { VitalsTrendChart, type TrendPoint } from "../../_components/VitalsTrendChart";
import { pulseFetch } from "../../_lib/pulseClient";
import type { VitalReading } from "../../_lib/pulseTypes";
import {
  VITAL_META,
  classifyVital,
  formatVitalValue,
  trendTextClass,
} from "../../_lib/vitalsDisplay";

type Tab = "recent" | "trends";

const WINDOWS: { key: string; label: string }[] = [
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "1y", label: "1Y" },
];

interface TrendState {
  loading: boolean;
  points: TrendPoint[];
  summary: {
    count: number;
    min: number | null;
    max: number | null;
    average: number | null;
  } | null;
}

export function VitalsSurface({
  initialReadings,
  initialAddKind,
}: {
  initialReadings: VitalReading[];
  initialAddKind: VitalKind | null;
}) {
  const [readings, setReadings] = useState<VitalReading[]>(initialReadings);
  const [tab, setTab] = useState<Tab>("recent");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(initialAddKind !== null);

  // The kind we default the add-sheet to: an explicit ?add=, else the most
  // recently logged kind, else BP.
  const lastKind: VitalKind = readings[0]?.kind ?? "bp";
  const defaultAddKind: VitalKind = initialAddKind ?? lastKind;

  // Kinds the patient actually has data for (for the Trends picker).
  const kindsWithData = useMemo(() => {
    const seen = new Set<VitalKind>();
    const order: VitalKind[] = [];
    for (const r of readings) {
      if (!seen.has(r.kind)) {
        seen.add(r.kind);
        order.push(r.kind);
      }
    }
    return order;
  }, [readings]);

  const [trendKind, setTrendKind] = useState<VitalKind>(lastKind);
  const [trendWindow, setTrendWindow] = useState("30d");
  const [trend, setTrend] = useState<TrendState>({
    loading: false,
    points: [],
    summary: null,
  });

  const refetchReadings = useCallback(async () => {
    const { ok, data } = await pulseFetch<{ readings?: VitalReading[] }>(
      "/api/pulse/vitals?limit=100",
    );
    if (ok && data.readings) setReadings(data.readings);
  }, []);

  // Keep the trend kind valid as data changes.
  useEffect(() => {
    if (kindsWithData.length > 0 && !kindsWithData.includes(trendKind)) {
      setTrendKind(kindsWithData[0]);
    }
  }, [kindsWithData, trendKind]);

  // Load the trend whenever the Trends tab is active and kind/window change.
  useEffect(() => {
    if (tab !== "trends") return;
    let cancelled = false;
    setTrend((t) => ({ ...t, loading: true }));
    (async () => {
      const { ok, data } = await pulseFetch<{
        series?: {
          value_numeric: number;
          value_secondary: number | null;
          taken_at: string;
        }[];
        summary?: TrendState["summary"];
      }>(
        `/api/pulse/vitals/trends?kind=${encodeURIComponent(
          trendKind,
        )}&window=${trendWindow}`,
      );
      if (cancelled) return;
      const series = ok && data.series ? data.series : [];
      const points: TrendPoint[] = series.map((s) => ({
        label: formatIST(s.taken_at, "date"),
        primary: s.value_numeric,
        secondary: s.value_secondary,
      }));
      setTrend({
        loading: false,
        points,
        summary: (ok && data.summary) || null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, trendKind, trendWindow]);

  async function handleDelete(id: string) {
    setDeletingId(id);
    const { ok } = await pulseFetch(`/api/pulse/vitals/${id}`, {
      method: "DELETE",
    });
    if (ok) {
      setReadings((prev) => prev.filter((r) => r.id !== id));
      setExpandedId(null);
    }
    setDeletingId(null);
  }

  function handleSaved(reading: VitalReading) {
    setSheetOpen(false);
    // Optimistic prepend, then reconcile with the server ordering.
    setReadings((prev) => [reading, ...prev]);
    setTab("recent");
    void refetchReadings();
  }

  const isEmpty = readings.length === 0;

  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      <div className="mx-auto max-w-2xl px-4 pt-4">
        {isEmpty ? (
          <EmptyVitals onAdd={() => setSheetOpen(true)} />
        ) : (
          <>
            {/* Tabs */}
            <div className="flex rounded-2xl bg-slate-100 p-1">
              <TabButton
                active={tab === "recent"}
                onClick={() => setTab("recent")}
                icon={<ListChecks className="h-4 w-4" />}
                label="Recent"
              />
              <TabButton
                active={tab === "trends"}
                onClick={() => setTab("trends")}
                icon={<LineChartIcon className="h-4 w-4" />}
                label="Trends"
              />
            </div>

            {tab === "recent" ? (
              <ul className="mt-4 space-y-2">
                {readings.map((r) => (
                  <ReadingRow
                    key={r.id}
                    reading={r}
                    expanded={expandedId === r.id}
                    deleting={deletingId === r.id}
                    onToggle={() =>
                      setExpandedId((cur) => (cur === r.id ? null : r.id))
                    }
                    onDelete={() => handleDelete(r.id)}
                  />
                ))}
              </ul>
            ) : (
              <TrendsPanel
                kinds={kindsWithData}
                kind={trendKind}
                onKind={setTrendKind}
                window={trendWindow}
                onWindow={setTrendWindow}
                state={trend}
              />
            )}
          </>
        )}
      </div>

      <PulseStickyBar
        onClick={() => setSheetOpen(true)}
        ariaLabel="Log a vital"
      >
        <Plus className="h-4 w-4" />
        Log a vital
      </PulseStickyBar>

      <AddVitalSheet
        open={sheetOpen}
        defaultKind={defaultAddKind}
        onClose={() => setSheetOpen(false)}
        onSaved={handleSaved}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors " +
        (active
          ? "bg-white text-primary shadow-sm"
          : "text-text-secondary hover:text-text-main")
      }
    >
      {icon}
      {label}
    </button>
  );
}

function ReadingRow({
  reading,
  expanded,
  deleting,
  onToggle,
  onDelete,
}: {
  reading: VitalReading;
  expanded: boolean;
  deleting: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const meta = VITAL_META[reading.kind];
  const trend = classifyVital(reading);

  return (
    <li className="overflow-hidden rounded-2xl bg-white shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div>
          <div className="text-sm font-bold text-text-main">
            {formatVitalValue(reading)}{" "}
            <span className="text-xs font-medium text-slate-400">
              {meta.unit}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-text-secondary">
            {meta.label} · {formatIST(reading.taken_at, "relativeShort")}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={"text-sm font-semibold " + trendTextClass(trend)}>
            ●
          </span>
          <ChevronDown
            className={
              "h-4 w-4 text-slate-400 transition-transform " +
              (expanded ? "rotate-180" : "")
            }
          />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3">
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between">
              <dt className="text-slate-400">Logged</dt>
              <dd className="text-text-secondary">
                {formatIST(reading.taken_at, "datetime")}
              </dd>
            </div>
            {reading.context_note && (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Note</dt>
                <dd className="text-right text-text-secondary">
                  {reading.context_note}
                </dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-slate-400">Source</dt>
              <dd className="text-text-secondary capitalize">
                {reading.source}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-100 disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Delete reading
          </button>
        </div>
      )}
    </li>
  );
}

function TrendsPanel({
  kinds,
  kind,
  onKind,
  window: win,
  onWindow,
  state,
}: {
  kinds: VitalKind[];
  kind: VitalKind;
  onKind: (k: VitalKind) => void;
  window: string;
  onWindow: (w: string) => void;
  state: TrendState;
}) {
  const meta = VITAL_META[kind];
  const isBp = kind === "bp";

  return (
    <div className="mt-4">
      {/* Kind picker */}
      <div className="flex flex-wrap gap-2">
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onKind(k)}
            className={
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
              (k === kind
                ? "bg-primary text-white"
                : "bg-white text-text-secondary shadow-sm hover:bg-slate-100")
            }
          >
            {VITAL_META[k].label}
          </button>
        ))}
      </div>

      <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-text-main">
            {meta.label} trend
          </h2>
          {/* Window toggle */}
          <div className="flex rounded-xl bg-slate-100 p-0.5">
            {WINDOWS.map((w) => (
              <button
                key={w.key}
                type="button"
                onClick={() => onWindow(w.key)}
                className={
                  "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors " +
                  (w.key === win
                    ? "bg-white text-primary shadow-sm"
                    : "text-text-secondary")
                }
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3">
          {state.loading ? (
            <div className="flex h-[180px] items-center justify-center text-sm text-text-secondary">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : state.points.length === 0 ? (
            <div className="flex h-[180px] items-center justify-center px-6 text-center text-sm text-text-secondary">
              No {meta.label.toLowerCase()} readings in this window yet.
            </div>
          ) : (
            <VitalsTrendChart
              points={state.points}
              isBp={isBp}
              unitLabel={meta.unit || meta.label}
            />
          )}
        </div>

        {state.summary && state.summary.count > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
            <SummaryCell label="Low" value={state.summary.min} unit={meta.unit} />
            <SummaryCell
              label="Average"
              value={state.summary.average}
              unit={meta.unit}
            />
            <SummaryCell label="High" value={state.summary.max} unit={meta.unit} />
          </div>
        )}
      </div>
      {isBp && (
        <p className="mt-2 px-1 text-center text-xs text-slate-400">
          Systolic (rose) over diastolic (blue).
        </p>
      )}
    </div>
  );
}

function SummaryCell({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | null;
  unit: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </div>
      <div className="mt-0.5 text-base font-bold text-text-main">
        {value == null ? "—" : value}
        {unit && value != null ? (
          <span className="ml-0.5 text-[10px] font-medium text-slate-400">
            {unit}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function EmptyVitals({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="mt-10 rounded-3xl bg-white p-8 text-center shadow-sm">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary">
        <LineChartIcon className="h-7 w-7" />
      </div>
      <p className="mx-auto mt-4 max-w-xs text-sm leading-relaxed text-text-secondary">
        Track your BP, sugar, and weight over time. Watch the trends. Catch
        changes early.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white shadow-lg shadow-primary/30"
      >
        <Plus className="h-4 w-4" />
        Log your first reading
      </button>
    </div>
  );
}
