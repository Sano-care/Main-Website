"use client";

import { useState, useTransition } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { recordPayout, postAdjustment } from "../actions";

/**
 * Admin-only side-by-side cards: Record Payout + Post Adjustment.
 *
 * Both write directly to doctor_ledger_entries (RLS INSERT for
 * is_ops_admin). The server actions re-check is_ops_admin via RPC, so
 * even if a non-admin somehow renders this component the writes are
 * rejected at the server.
 *
 * Payouts are stored as NEGATIVE — the form takes a positive amount in
 * rupees and the server flips the sign. Adjustments are SIGNED — the
 * form accepts a positive or negative number directly.
 */
export function AdminActions({ doctorId }: { doctorId: string }) {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="grid lg:grid-cols-2 gap-4 mb-6">
      <PayoutCard doctorId={doctorId} today={today} />
      <AdjustmentCard doctorId={doctorId} today={today} />
    </div>
  );
}

function PayoutCard({ doctorId, today }: { doctorId: string; today: string }) {
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (formData: FormData) => {
    setError(null);
    setOk(null);
    startTransition(async () => {
      try {
        await recordPayout(formData);
        setOk("Payout recorded.");
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        setError(e instanceof Error ? e.message : "Could not record payout");
      }
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6">
      <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-3">
        Record payout
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Money sent to the doctor (bank transfer, cash, etc.). Stored as a
        negative ledger entry — reduces the current balance.
      </p>
      <form action={submit} className="space-y-3">
        <input type="hidden" name="doctor_id" value={doctorId} />
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-slate-700 mb-1">
              Amount (₹) *
            </span>
            <input
              type="number"
              name="amount_rupees"
              min={0.01}
              step="any"
              required
              placeholder="Positive number"
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-700 mb-1">Date *</span>
            <input
              type="date"
              name="entry_date"
              required
              defaultValue={today}
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            />
          </label>
        </div>
        <label className="block">
          <span className="block text-xs font-medium text-slate-700 mb-1">
            Note
          </span>
          <input
            type="text"
            name="note"
            placeholder="e.g. UPI to xxx, ref ABC123"
            className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
          />
        </label>
        <Feedback ok={ok} error={error} />
        <button
          type="submit"
          disabled={isPending}
          className="bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          {isPending ? "Recording…" : "Record payout"}
        </button>
      </form>
    </div>
  );
}

function AdjustmentCard({ doctorId, today }: { doctorId: string; today: string }) {
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (formData: FormData) => {
    setError(null);
    setOk(null);
    startTransition(async () => {
      try {
        await postAdjustment(formData);
        setOk("Adjustment posted.");
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        setError(e instanceof Error ? e.message : "Could not post adjustment");
      }
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6">
      <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-3">
        Post adjustment
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Manual correction. Sign matters — positive credits the doctor,
        negative debits. Use for revenue-share recompute fixes or one-off
        true-ups. The note is mandatory and surfaces on the ledger row.
      </p>
      <form action={submit} className="space-y-3">
        <input type="hidden" name="doctor_id" value={doctorId} />
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-slate-700 mb-1">
              Amount (₹) — signed *
            </span>
            <input
              type="number"
              name="amount_rupees"
              step="any"
              required
              placeholder="e.g. 500 or -250"
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-700 mb-1">Date *</span>
            <input
              type="date"
              name="entry_date"
              required
              defaultValue={today}
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            />
          </label>
        </div>
        <label className="block">
          <span className="block text-xs font-medium text-slate-700 mb-1">
            Reason / note *
          </span>
          <textarea
            name="note"
            rows={2}
            required
            placeholder="Why is this adjustment being made?"
            className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
          />
        </label>
        <Feedback ok={ok} error={error} />
        <button
          type="submit"
          disabled={isPending}
          className="bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          {isPending ? "Posting…" : "Post adjustment"}
        </button>
      </form>
    </div>
  );
}

function Feedback({ ok, error }: { ok: string | null; error: string | null }) {
  if (ok) {
    return (
      <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-lg px-3 py-2">
        <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {ok}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg px-3 py-2">
        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
      </div>
    );
  }
  return null;
}
