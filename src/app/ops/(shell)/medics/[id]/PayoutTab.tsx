"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { rupees } from "@/lib/doctorFinance";
import { formatIST } from "@/lib/time/formatIST";

// T65 Phase 2B C5a — Payout tab.
//
// Top: paginated ledger table (date / type / amount / description / booking
// link / running balance) with a date-range picker (current month default),
// an admin-only "Add ledger entry" button, and an admin-only "Settle now"
// button. Bottom: the last-5 settlements panel (server-fetched, passed in)
// with a proof-doc link that reuses the C4 signed-URL flow.
//
// The ledger is fetched client-side from GET .../ledger so the date-range
// picker + pagination don't need a full page reload. Settlements are
// server-fetched once (they only change on a settle, after which we
// router.refresh()).

const ENTRY_TYPE_STYLE: Record<string, string> = {
  revenue_share: "bg-emerald-100 text-emerald-800",
  commission: "bg-emerald-100 text-emerald-800",
  daily_wage: "bg-blue-100 text-blue-800",
  overtime: "bg-violet-100 text-violet-800",
  payout: "bg-rose-100 text-rose-800",
  adjustment: "bg-amber-100 text-amber-800",
  reversal: "bg-slate-200 text-slate-700",
};

const ENTRY_TYPE_LABEL: Record<string, string> = {
  revenue_share: "Revenue share",
  commission: "Commission",
  daily_wage: "Daily wage",
  overtime: "Overtime",
  payout: "Payout",
  adjustment: "Adjustment",
  reversal: "Reversal",
};

// Manual-entry types (payout goes through Settle; reversal is out of scope).
const MANUAL_ENTRY_TYPES: Array<{ key: string; label: string }> = [
  { key: "daily_wage", label: "Daily wage" },
  { key: "revenue_share", label: "Revenue share" },
  { key: "commission", label: "Commission" },
  { key: "overtime", label: "Overtime" },
  { key: "adjustment", label: "Adjustment (signed)" },
];

const PAYOUT_METHODS: Array<{ key: string; label: string }> = [
  { key: "upi", label: "UPI" },
  { key: "bank_transfer", label: "Bank transfer" },
  { key: "cash", label: "Cash" },
  { key: "other", label: "Other" },
];

const PAYOUT_METHOD_LABEL: Record<string, string> = Object.fromEntries(
  PAYOUT_METHODS.map((m) => [m.key, m.label]),
);

const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

type LedgerRow = {
  id: string;
  entry_type: string;
  amount_paise: number;
  entry_date: string;
  description: string | null;
  booking_id: string | null;
  booking_code: string | null;
  running_balance_paise: number;
  created_at: string;
};

type LedgerResponse = {
  rows: LedgerRow[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
  range: { from: string; to: string };
};

export type Settlement = {
  id: string;
  amount_paise: number;
  reference_text: string;
  payout_method: string;
  settled_at: string;
  proof_doc_id: string;
  notes: string | null;
};

export type PayConfig = {
  medic_type: "freelancer" | "salaried";
  revenue_share_pct: number | null;
  daily_wage_paise: number | null;
  commission_per_visit_paise: number | null;
  overtime_hourly_paise: number | null;
  pay_notes: string | null;
};

interface PayoutTabProps {
  medicId: string;
  isAdmin: boolean;
  settlements: Settlement[];
  payConfig: PayConfig;
  summary: { earnedPaise: number; paidPaise: number; balancePaise: number };
}

function istMonthStart(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}-01`;
}

function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function EntryTypeBadge({ type }: { type: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        ENTRY_TYPE_STYLE[type] ?? "bg-slate-100 text-slate-700"
      }`}
    >
      {ENTRY_TYPE_LABEL[type] ?? type}
    </span>
  );
}

export function PayoutTab({
  medicId,
  isAdmin,
  settlements,
  payConfig,
  summary,
}: PayoutTabProps) {
  const [from, setFrom] = useState(istMonthStart());
  const [to, setTo] = useState(istToday());
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [showSettle, setShowSettle] = useState(false);

  const loadLedger = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ from, to, page: String(page) });
      const res = await fetch(
        `/api/ops/medics/${medicId}/ledger?${qs.toString()}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(`Could not load ledger: ${body.error ?? res.statusText}`);
        return;
      }
      setData((await res.json()) as LedgerResponse);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load ledger.");
    } finally {
      setLoading(false);
    }
  }, [medicId, from, to, page]);

  useEffect(() => {
    // Fetch-on-mount + on-filter-change. loadLedger sets loading=true
    // synchronously, which the rule flags — but a loading indicator is the
    // intended behaviour here, not a cascading-render bug.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLedger();
  }, [loadLedger]);

  // After a successful mutation: reset to page 1 + reload ledger. Settlements
  // are server-rendered, so a settle also triggers a router.refresh() inside
  // the modal.
  const onMutated = () => {
    setPage(1);
    void loadLedger();
  };

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-8">
      {/* Earned / paid / balance summary (whole ledger) */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard label="Earned" value={summary.earnedPaise} />
        <SummaryCard label="Paid out" value={summary.paidPaise} />
        <SummaryCard label="Balance" value={summary.balancePaise} emphasize />
      </div>

      {/* Pay configuration (medic_type + rates). Admin-editable. */}
      <PayConfigCard
        medicId={medicId}
        isAdmin={isAdmin}
        config={payConfig}
      />

      {/* Header: date range + actions */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex items-end gap-3">
          <label className="block">
            <span className="block text-xs text-slate-500 mb-1">From</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-slate-500 mb-1">To</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
            />
          </label>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAddEntry(true)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Add ledger entry
            </button>
            <button
              type="button"
              onClick={() => setShowSettle(true)}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Settle now
            </button>
          </div>
        )}
      </div>

      {/* Ledger table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-baseline justify-between">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
            Ledger
          </div>
          <div className="text-xs text-slate-500">
            {data ? `${data.total} entries in range · newest first` : "…"}
          </div>
        </div>

        {err && (
          <div className="px-6 py-4 text-sm text-red-600">{err}</div>
        )}

        {loading && !data ? (
          <div className="px-6 py-8 text-center text-sm text-slate-500">
            Loading ledger…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-slate-500">
            No ledger entries in this date range.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left">
                  <Th>Date</Th>
                  <Th>Type</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Description</Th>
                  <Th className="text-right">Balance</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-slate-100 last:border-b-0"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {formatIST(r.entry_date, "date")}
                    </td>
                    <td className="px-4 py-3">
                      <EntryTypeBadge type={r.entry_type} />
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono whitespace-nowrap ${
                        r.amount_paise < 0 ? "text-rose-700" : "text-slate-900"
                      }`}
                    >
                      {rupees(r.amount_paise)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {r.description ?? "—"}
                      {r.booking_id && (
                        <>
                          {" "}
                          <Link
                            href={`/ops/bookings/${r.booking_id}`}
                            className="text-blue-600 hover:underline whitespace-nowrap"
                          >
                            {r.booking_code ?? "booking →"}
                          </Link>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono whitespace-nowrap text-slate-900">
                      {rupees(r.running_balance_paise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data && data.total > data.page_size && (
          <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between text-sm">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              ← Newer
            </button>
            <span className="text-xs text-slate-500">
              Page {data.page} of {Math.max(1, Math.ceil(data.total / data.page_size))}
            </span>
            <button
              type="button"
              disabled={!data.has_more || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Older →
            </button>
          </div>
        )}
      </div>

      {/* Last-5 settlements */}
      <SettlementsPanel medicId={medicId} settlements={settlements} />

      {isAdmin && showAddEntry && (
        <AddEntryModal
          medicId={medicId}
          onClose={() => setShowAddEntry(false)}
          onDone={() => {
            setShowAddEntry(false);
            onMutated();
          }}
        />
      )}
      {isAdmin && showSettle && (
        <SettleModal
          medicId={medicId}
          onClose={() => setShowSettle(false)}
          onDone={() => {
            setShowSettle(false);
            onMutated();
          }}
        />
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        emphasize ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"
      }`}
    >
      <div
        className={`text-[10px] font-mono uppercase tracking-wider ${
          emphasize ? "text-slate-300" : "text-slate-500"
        }`}
      >
        {label}
      </div>
      <div className="mt-1 font-mono text-lg">{rupees(value)}</div>
    </div>
  );
}

// Pay configuration — medic_type + conditional rate fields + pay_notes. Mirrors
// the doctor pay-terms card. Admins can edit; agents see read-only. NULL rates
// are allowed (B1) — the accrual COALESCEs them to 0, so a freelancer with no %
// or a salaried with no wage simply earns nothing until configured.
const RUPEE_FIELDS = [
  { key: "daily_wage_paise", label: "Daily wage (₹)" },
  { key: "commission_per_visit_paise", label: "Per-visit commission (₹)" },
  { key: "overtime_hourly_paise", label: "Overtime / hr (₹)" },
] as const;

function PayConfigCard({
  medicId,
  isAdmin,
  config,
}: {
  medicId: string;
  isAdmin: boolean;
  config: PayConfig;
}) {
  const router = useRouter();
  const [medicType, setMedicType] = useState(config.medic_type);
  const [revSharePct, setRevSharePct] = useState(
    config.revenue_share_pct == null ? "" : String(config.revenue_share_pct),
  );
  const [rupeeVals, setRupeeVals] = useState<Record<string, string>>({
    daily_wage_paise:
      config.daily_wage_paise == null ? "" : String(config.daily_wage_paise / 100),
    commission_per_visit_paise:
      config.commission_per_visit_paise == null
        ? ""
        : String(config.commission_per_visit_paise / 100),
    overtime_hourly_paise:
      config.overtime_hourly_paise == null
        ? ""
        : String(config.overtime_hourly_paise / 100),
  });
  const [payNotes, setPayNotes] = useState(config.pay_notes ?? "");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = () => {
    setMsg(null);
    const payload: Record<string, unknown> = {
      medic_type: medicType,
      pay_notes: payNotes.trim() || null,
    };
    if (medicType === "freelancer") {
      payload.revenue_share_pct = revSharePct === "" ? null : Number(revSharePct);
    } else {
      for (const f of RUPEE_FIELDS) {
        const v = rupeeVals[f.key];
        payload[f.key] = v === "" ? null : Math.round(Number(v) * 100);
      }
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/ops/medics/${medicId}/pay-config`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMsg({ ok: false, text: `${body.error ?? res.statusText}${body.detail ? ` — ${body.detail}` : ""}` });
          return;
        }
        setMsg({ ok: true, text: "Saved." });
        router.refresh();
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "Save failed." });
      }
    });
  };

  const inputCls =
    "w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
          Pay configuration
        </div>
        {!isAdmin && (
          <span className="text-xs text-slate-400">read-only (admin to edit)</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500">Medic type</span>
          <select
            value={medicType}
            disabled={!isAdmin || pending}
            onChange={(e) => setMedicType(e.target.value as PayConfig["medic_type"])}
            className={inputCls}
          >
            <option value="salaried">Salaried</option>
            <option value="freelancer">Freelancer</option>
          </select>
        </label>

        {medicType === "freelancer" ? (
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">
              Revenue share (%)
            </span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={revSharePct}
              disabled={!isAdmin || pending}
              onChange={(e) => setRevSharePct(e.target.value)}
              className={`${inputCls} font-mono`}
            />
          </label>
        ) : (
          RUPEE_FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="mb-1 block text-xs text-slate-500">{f.label}</span>
              <input
                type="number"
                min="0"
                step="1"
                value={rupeeVals[f.key]}
                disabled={!isAdmin || pending}
                onChange={(e) =>
                  setRupeeVals((p) => ({ ...p, [f.key]: e.target.value }))
                }
                className={`${inputCls} font-mono`}
              />
            </label>
          ))
        )}

        <label className="col-span-2 block">
          <span className="mb-1 block text-xs text-slate-500">Pay notes</span>
          <textarea
            value={payNotes}
            disabled={!isAdmin || pending}
            onChange={(e) => setPayNotes(e.target.value)}
            rows={2}
            maxLength={500}
            className={inputCls}
          />
        </label>
      </div>

      {msg && (
        <p className={`mt-3 text-xs ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>
          {msg.text}
        </p>
      )}

      {isAdmin && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save pay config"}
          </button>
        </div>
      )}
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

function SettlementsPanel({
  medicId,
  settlements,
}: {
  medicId: string;
  settlements: Settlement[];
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-baseline justify-between">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
          Last 5 settlements
        </div>
        <div className="text-xs text-slate-500">
          {settlements.length} shown
        </div>
      </div>
      {settlements.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-slate-500">
          No payouts settled yet.
        </div>
      ) : (
        <ul>
          {settlements.map((s) => (
            <li
              key={s.id}
              className="px-6 py-3 border-b border-slate-100 last:border-b-0 flex items-center justify-between gap-3 flex-wrap"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-slate-900">
                    {rupees(s.amount_paise)}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                    {PAYOUT_METHOD_LABEL[s.payout_method] ?? s.payout_method}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {formatIST(s.settled_at, "datetime")} · ref {s.reference_text}
                  {s.notes && <> · {s.notes}</>}
                </div>
              </div>
              <ProofLink medicId={medicId} docId={s.proof_doc_id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProofLink({ medicId, docId }: { medicId: string; docId: string }) {
  const [opening, setOpening] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = async () => {
    setErr(null);
    setOpening(true);
    try {
      const res = await fetch(
        `/api/ops/medics/${medicId}/docs/${docId}/signed-url`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(`Could not open: ${body.error ?? res.statusText}`);
        return;
      }
      const { url } = await res.json();
      if (typeof url === "string") {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Open failed.");
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={open}
        disabled={opening}
        className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-50"
      >
        {opening ? "Opening…" : "View proof"}
      </button>
      {err && <p className="mt-0.5 text-xs text-red-600">{err}</p>}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function AddEntryModal({
  medicId,
  onClose,
  onDone,
}: {
  medicId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [entryType, setEntryType] = useState(MANUAL_ENTRY_TYPES[0].key);
  const [amount, setAmount] = useState("");
  const [entryDate, setEntryDate] = useState(istToday());
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    setErr(null);
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt === 0) {
      setErr("Enter a non-zero amount (₹).");
      return;
    }
    if (entryType !== "adjustment" && amt < 0) {
      setErr("Only adjustments may be negative.");
      return;
    }
    if (entryType === "adjustment" && description.trim().length === 0) {
      setErr("Adjustments need a note.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/ops/medics/${medicId}/ledger`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entry_type: entryType,
            amount: amt,
            entry_date: entryDate,
            description: description.trim() || null,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setErr(`Failed: ${body.error ?? res.statusText}`);
          return;
        }
        onDone();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to add entry.");
      }
    });
  };

  return (
    <Modal title="Add ledger entry" onClose={onClose}>
      <div className="space-y-4">
        <label className="block">
          <span className="block text-xs text-slate-500 mb-1">Entry type</span>
          <select
            value={entryType}
            onChange={(e) => setEntryType(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
          >
            {MANUAL_ENTRY_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs text-slate-500 mb-1">
            Amount (₹){entryType === "adjustment" && " — minus to debit"}
          </span>
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="500"
            className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-mono"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-slate-500 mb-1">Date</span>
          <input
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-slate-500 mb-1">
            Description{entryType === "adjustment" && " (required)"}
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={500}
            className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
          />
        </label>
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {pending ? "Adding…" : "Add entry"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SettleModal({
  medicId,
  onClose,
  onDone,
}: {
  medicId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [payoutMethod, setPayoutMethod] = useState(PAYOUT_METHODS[0].key);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    setErr(null);
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setErr("Enter a positive payout amount (₹).");
      return;
    }
    const ref = referenceText.trim();
    if (ref.length === 0 || ref.length > 120) {
      setErr("Reference (UPI/bank txn ID) is required, max 120 chars.");
      return;
    }
    if (!file) {
      setErr("A proof file (image or PDF) is required.");
      return;
    }
    if (!ALLOWED_MIMES.includes(file.type)) {
      setErr("Proof must be JPEG, PNG, WebP, or PDF.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setErr(`Proof too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 10 MB.`);
      return;
    }

    const amountPaise = Math.round(amt * 100);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("amount_paise", String(amountPaise));
    fd.set("reference_text", ref);
    fd.set("payout_method", payoutMethod);
    if (notes.trim()) fd.set("notes", notes.trim());

    startTransition(async () => {
      try {
        const res = await fetch(`/api/ops/medics/${medicId}/settle`, {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setErr(`Settle failed: ${body.error ?? res.statusText}`);
          return;
        }
        // Refresh the server-rendered settlements panel, then let the
        // parent reset the ledger.
        router.refresh();
        onDone();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Settle failed.");
      }
    });
  };

  return (
    <Modal title="Settle payout" onClose={onClose}>
      <div className="space-y-4">
        <label className="block">
          <span className="block text-xs text-slate-500 mb-1">Amount (₹)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="100"
            className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-mono"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-slate-500 mb-1">
            Reference (UPI / bank txn ID)
          </span>
          <input
            type="text"
            value={referenceText}
            maxLength={120}
            onChange={(e) => setReferenceText(e.target.value)}
            placeholder="UPI ref 4839201..."
            className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-slate-500 mb-1">Method</span>
          <select
            value={payoutMethod}
            onChange={(e) => setPayoutMethod(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
          >
            {PAYOUT_METHODS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs text-slate-500 mb-1">
            Proof (image or PDF, max 10 MB)
          </span>
          <input
            type="file"
            accept={ALLOWED_MIMES.join(",")}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-slate-50 file:px-3 file:py-1.5 file:text-xs file:font-medium"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-slate-500 mb-1">Notes (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={500}
            className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
          />
        </label>
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {pending ? "Settling…" : "Settle payout"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
