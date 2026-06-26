"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { SectionReveal } from "@/components/marketing/SectionReveal";
import { useViewingFirstName } from "@/app/pulse/_lib/MemberViewingContext";
import type { PulseRecords } from "@/lib/pulse/recordsFetch";
import { useRecords } from "./useRecords";
import {
  BANDS,
  CATEGORY_CONFIG,
  TIER_ICON,
  tileSummary,
  type RecordTier,
  type RecordTileKey,
} from "./categories";

// R1 — Records landing. A tiered tile grid (the ownership model IS the visual
// system): three labelled bands, each tile a single link into its detail
// "bank-statement" screen. Presentation only — reads the same /api/pulse/records
// payload the old flat surface loaded, scoped by the active viewing member.

// The soft icon-wrapper bg + accent stroke per tier live in categories.TIER_ICON
// (single-sourced, shared with the detail headers). This map holds the rest of
// the tile's per-tier treatment.
const TIER_UI: Record<
  RecordTier,
  { border: string; chip: string; chipText: string; action: string }
> = {
  sanocare: {
    border: "border-t-[3px] border-t-[#2B81FF]",
    chip: "bg-[#EAF2FF] text-[#2B81FF]",
    chipText: "Auto",
    action: "text-slate-500",
  },
  hybrid: {
    border: "border-t-[3px] border-t-slate-400",
    chip: "bg-slate-100 text-slate-600",
    chipText: "You + Sanocare",
    action: "text-[#2B81FF]",
  },
  yours: {
    border: "border-t-[3px] border-t-[#F4845A]",
    chip: "bg-[#FEF1EC] text-[#C2410C]",
    chipText: "You",
    action: "text-[#F4845A]",
  },
};

export default function RecordsLanding() {
  const { state, viewing, initialLoading, stale } = useRecords();
  const viewingName = useViewingFirstName();
  const heading = viewing.kind === "self" ? "Your records" : `${viewingName}'s records`;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5">
      <header className="mb-2">
        <h1 className="text-xl font-bold tracking-tight text-text-main">{heading}</h1>
        <p className="mt-0.5 text-sm text-text-secondary">
          Everything in one place — what Sanocare keeps, and what you track.
        </p>
      </header>

      {initialLoading ? (
        <TileSkeleton />
      ) : state.status === "error" ? (
        <ErrorCard message={state.message} />
      ) : state.status === "ready" ? (
        <>
          {stale ? (
            <p className="mb-1 text-xs text-text-secondary" role="status">
              Updating…
            </p>
          ) : null}
          <div className="flex flex-col gap-1">
            {BANDS.map((band, i) => (
              <SectionReveal key={band.tier} delay={i * 60}>
                <section className="pt-3">
                  <div className="flex items-center gap-2 px-1 pb-2">
                    <span className={"h-[7px] w-[7px] rounded-full " + band.pinClass} aria-hidden />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                      {band.label}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {band.keys.map((key) => (
                      <Tile key={key} tileKey={key} records={state.records} />
                    ))}
                  </div>
                </section>
              </SectionReveal>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Tile({ tileKey, records }: { tileKey: RecordTileKey; records: PulseRecords }) {
  const cfg = CATEGORY_CONFIG[tileKey];
  const ui = TIER_UI[cfg.tier];
  const tint = TIER_ICON[cfg.tier];
  const summary = tileSummary(tileKey, records);
  const Icon = cfg.icon;

  return (
    <Link
      href={`/pulse/records/${cfg.key}`}
      className={
        "flex flex-col rounded-2xl border border-slate-200 bg-white p-3 outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary/40 " +
        ui.border
      }
    >
      <span
        className={"mb-2 flex h-9 w-9 items-center justify-center rounded-xl " + tint.wrapBg}
        aria-hidden="true"
      >
        <Icon className={"h-5 w-5 [stroke-width:1.8] " + tint.stroke} aria-hidden="true" />
      </span>
      <span className="text-sm font-bold text-text-main">{cfg.label}</span>
      <span className="mt-0.5 text-[11px] text-text-secondary">
        {summary.count != null ? (
          <>
            <span className="font-mono font-semibold text-text-main">{summary.count}</span>{" "}
            {summary.label}
          </>
        ) : (
          summary.label
        )}
      </span>
      <span className="mt-2.5 flex items-center justify-between">
        <span
          className={
            "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide " + ui.chip
          }
        >
          {ui.chipText}
        </span>
        <span className={"text-[11px] font-bold " + ui.action}>{cfg.tileAction}</span>
      </span>
    </Link>
  );
}

function TileSkeleton() {
  return (
    <div className="mt-4 flex flex-col gap-4" aria-hidden="true">
      {[0, 1, 2].map((b) => (
        <div key={b}>
          <div className="mb-2 h-3 w-40 rounded bg-slate-100" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {[0, 1].map((t) => (
              <div key={t} className="h-28 rounded-2xl bg-white shadow-sm" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorCard({ message }: { message: string }): ReactNode {
  return (
    <div className="mt-4 rounded-2xl bg-white p-4 shadow-md">
      <p className="text-sm text-text-secondary">{message}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-3 rounded-lg bg-primary-50 px-3 py-1.5 text-sm font-bold text-primary hover:bg-blue-100"
      >
        Try again
      </button>
    </div>
  );
}
