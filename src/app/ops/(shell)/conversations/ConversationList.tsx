"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, AlertTriangle, Zap, Ban } from "lucide-react";

import {
  FILTERS,
  matchesFilter,
  matchesSearch,
  redactPhone,
  type ConvFilter,
  type ConversationRow,
} from "./types";

const SERVICE_LABEL: Record<string, string> = {
  doctor_visit: "Doctor visit",
  nursing: "Nursing",
  lab: "Lab",
  pharmacy: "Pharmacy",
  other: "Other",
  unknown: "Unknown",
};

export function ConversationList({
  conversations,
  selectedId,
  redact,
}: {
  conversations: ConversationRow[];
  selectedId: string | null;
  redact: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<ConvFilter>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const c: Record<ConvFilter, number> = {
      all: 0,
      active: 0,
      escalated: 0,
      emergency: 0,
      errors: 0,
      optout: 0,
    };
    for (const conv of conversations) {
      for (const f of FILTERS) {
        if (matchesFilter(conv, f.key)) c[f.key] += 1;
      }
    }
    return c;
  }, [conversations]);

  const rows = useMemo(
    () =>
      conversations.filter(
        (c) => matchesFilter(c, filter) && matchesSearch(c, query),
      ),
    [conversations, filter, query],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Sticky filter + search */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-3 py-3">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={
                "shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors " +
                (filter === f.key
                  ? "bg-[#2B81FF] text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200")
              }
            >
              {f.label}
              <span
                className={
                  "ml-1.5 tabular-nums " +
                  (filter === f.key ? "text-white/80" : "text-slate-400")
                }
              >
                {counts[f.key]}
              </span>
            </button>
          ))}
        </div>
        <div className="relative mt-2.5">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search phone or message…"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-[#2B81FF] focus:outline-none focus:ring-1 focus:ring-[#2B81FF]"
          />
        </div>
      </div>

      {/* Rows */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            No conversations match.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((c) => {
              const active = c.id === selectedId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() =>
                      router.push(`/ops/conversations?id=${c.id}`, { scroll: false })
                    }
                    className={
                      "flex min-h-[56px] w-full flex-col gap-1 px-4 py-3 text-left transition-colors " +
                      (active ? "bg-[#2B81FF]/5" : "hover:bg-slate-50")
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-semibold text-slate-900">
                        {redact ? redactPhone(c.phone) : c.phone}
                      </span>
                      <span className="shrink-0 text-xs text-slate-400">
                        {c.timeSinceLabel}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs text-slate-500">
                        {c.lastMessage
                          ? (c.lastMessage.direction === "outbound" ? "Aarogya: " : "") +
                            c.lastMessage.content
                          : "—"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {c.hasEmergency && (
                        <Badge tone="red">🚨 Emergency</Badge>
                      )}
                      {(c.hasEscalation || c.escalationStatus !== "none") && (
                        <Badge tone="orange">
                          <Zap className="h-3 w-3" /> Escalated
                        </Badge>
                      )}
                      {c.hasError && (
                        <Badge tone="red">
                          <AlertTriangle className="h-3 w-3" /> Error
                        </Badge>
                      )}
                      {c.optOut && (
                        <Badge tone="slate">
                          <Ban className="h-3 w-3" /> Opt-out
                        </Badge>
                      )}
                      {c.serviceIntent && c.serviceIntent !== "unknown" && (
                        <Badge tone="blue">
                          {SERVICE_LABEL[c.serviceIntent] ?? c.serviceIntent}
                        </Badge>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "red" | "orange" | "blue" | "slate";
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    red: "bg-rose-50 text-rose-700",
    orange: "bg-amber-50 text-amber-700",
    blue: "bg-[#2B81FF]/10 text-[#2B81FF]",
    slate: "bg-slate-100 text-slate-600",
  };
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium " +
        tones[tone]
      }
    >
      {children}
    </span>
  );
}
