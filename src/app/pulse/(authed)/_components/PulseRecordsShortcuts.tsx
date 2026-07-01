import Link from "next/link";

import {
  CATEGORY_CONFIG,
  RECORD_TILE_ORDER,
  TIER_ICON,
} from "../records/categories";

// R4 Part A — "Your records" quick-access on the Pulse home.
//
// A compact, mobile-first grid that deep-links into the per-category detail
// screens R1 built (/pulse/records/[category]). Everything is single-sourced
// from categories.ts — the same lucide monoline icon, three-tier colour cue
// (blue / slate / coral via TIER_ICON), and label the records landing + nav use
// — so the home shortcuts read as the same system and never drift.
//
// All nine categories are surfaced, in band/tier order. Each is a plain deep
// link to the category screen: the detail screen already renders its add control
// (Log / Add / Upload) as the first thing on the page, so a tap lands the
// patient one step from logging without this surface needing to carry add state.
// (Member scope is owned by the category screen via useRecords — these just
// navigate.)

export default function PulseRecordsShortcuts() {
  return (
    <section aria-labelledby="pulse-records-shortcuts-heading">
      <h2
        id="pulse-records-shortcuts-heading"
        className="mb-2 ml-1 text-sm font-bold text-text-main"
      >
        Your records
      </h2>
      <div className="grid grid-cols-3 gap-2 rounded-2xl bg-white p-3 shadow-sm sm:grid-cols-3">
        {RECORD_TILE_ORDER.map((key) => {
          const cfg = CATEGORY_CONFIG[key];
          const tint = TIER_ICON[cfg.tier];
          const Icon = cfg.icon;
          return (
            <Link
              key={key}
              href={`/pulse/records/${key}`}
              className="flex flex-col items-center gap-1.5 rounded-xl px-1.5 py-3 text-center outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <span
                className={
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl " +
                  tint.wrapBg
                }
                aria-hidden="true"
              >
                <Icon
                  className={"h-5 w-5 [stroke-width:1.8] " + tint.stroke}
                  aria-hidden="true"
                />
              </span>
              <span className="text-xs font-medium leading-tight text-text-main">
                {cfg.label}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
