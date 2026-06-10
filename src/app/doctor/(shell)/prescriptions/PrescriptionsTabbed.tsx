"use client";

// Client-side tab switcher for /doctor/prescriptions.
//
// v3 brief specifies a two-tab list (Drafts | Sent). The Sent tab also
// surfaces superseded + voided rows so the doctor has a single
// "issued" pane for everything beyond draft state — each row carries
// its own status pill for differentiation. Counts in each tab header
// reflect their actual rows so the doctor sees at a glance whether
// there's a draft waiting for them.
//
// The data comes pre-loaded as a server component prop; this client
// component only handles tab state + rendering. Status pills + link
// targets mirror the legacy stacked-section view exactly.

import { useState } from "react";
import Link from "next/link";
import {
  FileText,
  Send,
  History,
  FileX,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { formatIST } from "@/lib/time/formatIST";

export type RxListRow = {
  id: string;
  prescription_code: string;
  version: number;
  status: "draft" | "sent" | "superseded" | "voided";
  patient_name: string;
  session_id: string;
  created_at: string;
  sent_at: string | null;
  whatsapp_sent_at: string | null;
};

export function PrescriptionsTabbed({ rows }: { rows: RxListRow[] }) {
  const drafts = rows.filter((r) => r.status === "draft");
  // Sort sent/superseded/voided together by sent_at desc (or created_at
  // for voided rows that had patient_view_token cleared but sent_at
  // preserved). Drafts retain their natural newest-first order.
  const issued = rows
    .filter((r) => r.status !== "draft")
    .slice()
    .sort((a, b) => {
      const aT = a.sent_at ?? a.created_at;
      const bT = b.sent_at ?? b.created_at;
      return bT.localeCompare(aT);
    });

  // Default tab: Drafts if any exist, else Sent. Doctor's most
  // common need is "what do I have left to send?" so the draft side
  // wins when it's non-empty.
  const [tab, setTab] = useState<"drafts" | "sent">(
    drafts.length > 0 ? "drafts" : "sent",
  );

  const visible = tab === "drafts" ? drafts : issued;
  const emptyCopy =
    tab === "drafts"
      ? "No drafts open."
      : "No prescriptions sent yet.";

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-slate-200 mb-4">
        <TabButton
          active={tab === "drafts"}
          onClick={() => setTab("drafts")}
          icon={<FileText className="w-3.5 h-3.5" />}
          label="Drafts"
          count={drafts.length}
          highlight={drafts.length > 0}
        />
        <TabButton
          active={tab === "sent"}
          onClick={() => setTab("sent")}
          icon={<Send className="w-3.5 h-3.5" />}
          label="Sent"
          count={issued.length}
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        {visible.length === 0 ? (
          <div className="px-6 py-6 text-sm text-slate-400">{emptyCopy}</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visible.map((r) => (
              <li key={r.id}>
                <Link
                  href={
                    r.status === "draft"
                      ? `/doctor/sessions/${r.session_id}/prescribe`
                      : `/doctor/prescriptions/${r.prescription_code}`
                  }
                  className="px-6 py-3 hover:bg-slate-50 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm text-slate-900">
                        {r.prescription_code}
                      </span>
                      {r.version > 1 && (
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">
                          v{r.version}
                        </span>
                      )}
                      {tab === "sent" ? <StatusPill status={r.status} /> : null}
                    </div>
                    <div className="text-sm text-slate-700 truncate mt-0.5">
                      {r.patient_name}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-slate-500">
                    {r.status === "sent" ? (
                      <div className="flex items-center gap-1.5 justify-end">
                        <span>{formatIST(r.sent_at)}</span>
                        {r.whatsapp_sent_at ? (
                          <CheckCircle2
                            className="w-3.5 h-3.5 text-emerald-600"
                            aria-label="WhatsApp delivered"
                          />
                        ) : (
                          <AlertCircle
                            className="w-3.5 h-3.5 text-amber-600"
                            aria-label="WhatsApp not delivered"
                          />
                        )}
                      </div>
                    ) : (
                      <div>
                        {formatIST(r.sent_at ?? r.created_at)}
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
  highlight,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors " +
        (active
          ? "border-slate-900 text-slate-900"
          : "border-transparent text-slate-500 hover:text-slate-900")
      }
    >
      {icon}
      {label}
      <span
        className={
          "ml-1 inline-flex items-center justify-center min-w-[20px] h-5 rounded-full text-[11px] font-mono " +
          (active
            ? "bg-slate-900 text-white"
            : highlight
            ? "bg-amber-100 text-amber-900"
            : "bg-slate-100 text-slate-600")
        }
      >
        {count}
      </span>
    </button>
  );
}

function StatusPill({ status }: { status: RxListRow["status"] }) {
  switch (status) {
    case "sent":
      return null;
    case "superseded":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500 font-mono">
          <History className="w-3 h-3" /> Superseded
        </span>
      );
    case "voided":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-rose-600 font-mono">
          <FileX className="w-3 h-3" /> Voided
        </span>
      );
    default:
      return null;
  }
}

