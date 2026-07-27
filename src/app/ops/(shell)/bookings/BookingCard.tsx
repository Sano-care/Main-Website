"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ChevronRight, Loader2, RotateCcw } from "lucide-react";

import { changeStatus } from "./actions";
import { STATUS_STYLE, type BookingStatus } from "../../_lib/bookingStatus";
import { primaryAction } from "../../_lib/worklist";

// One booking, as a stacked card. This is the ONLY row rendering on mobile
// (the worklist uses a responsive card grid, no data table on small screens).
//
// Optimistic + rollback: a stage transition flips the pill immediately, then
// calls the existing `changeStatus` server action. On failure it reverts and
// shows a retryable message — the founder uses this on flaky connections at a
// patient's doorstep, so a dropped request must never silently look "done".
//
// One primary action per card, matched to the stage (worklist.primaryAction).
// Full-width, ≥44px. Brand blue (#2B81FF); coral (#F4845A) only on the error.

export interface CardBooking {
  id: string;
  booking_code: string | null;
  patient_name: string;
  customer_name: string | null;
  customer_code: string | null;
  phone: string | null;
  service_category: string | null;
  status: BookingStatus;
  amountRupees: number | null;
  whenLabel: string;
}

export function BookingCard({ b }: { b: CardBooking }) {
  const [status, setStatus] = useState<BookingStatus>(b.status);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const action = primaryAction(status);
  const detailHref = `/ops/bookings/${b.id}`;
  const displayName = b.customer_name ?? b.patient_name ?? "—";

  function runTransition(next: BookingStatus) {
    const prev = status;
    setError(null);
    setStatus(next); // optimistic
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("booking_id", b.id);
        fd.set("status", next);
        await changeStatus(fd);
      } catch {
        setStatus(prev); // rollback
        setError("Couldn't update — check your connection and retry.");
      }
    });
  }

  return (
    <div className="border border-slate-200 rounded-2xl bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={detailHref}
          className="font-mono text-sm font-semibold text-[#2B81FF] underline underline-offset-2 break-all"
        >
          {b.booking_code ?? `#${b.id.slice(0, 8)}`}
        </Link>
        <span className="font-mono text-sm font-semibold text-slate-900 whitespace-nowrap">
          {b.amountRupees != null ? `₹${b.amountRupees.toLocaleString("en-IN")}` : "—"}
        </span>
      </div>

      <div className="mt-1">
        <div className="text-base font-semibold text-slate-900 leading-tight">{displayName}</div>
        <div className="text-xs text-slate-500 mt-0.5">
          {b.customer_code && <span className="font-mono">{b.customer_code}</span>}
          {b.customer_code && b.phone && " · "}
          {b.phone && (
            <a href={`tel:${b.phone}`} className="underline underline-offset-2">
              {b.phone}
            </a>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={
            "text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-full " +
            (STATUS_STYLE[status] ?? "bg-slate-100 text-slate-700")
          }
        >
          {status.replace(/_/g, " ")}
        </span>
        {b.service_category && (
          <span className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-full px-2 py-1">
            {b.service_category}
          </span>
        )}
        <span className="text-[11px] text-slate-500">{b.whenLabel}</span>
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 text-[13px] text-[#F4845A]">
          <RotateCcw className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-3">
        {action.kind === "transition" ? (
          <button
            type="button"
            onClick={() => runTransition(action.nextStatus)}
            disabled={pending}
            className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#2B81FF] hover:bg-[#1E63D6] active:bg-[#1E63D6] disabled:opacity-60 text-white text-[15px] font-semibold px-4 transition-colors"
          >
            {pending && <Loader2 className="w-4 h-4 animate-spin" />}
            {action.label}
          </button>
        ) : (
          <Link
            href={detailHref}
            className="w-full min-h-[44px] inline-flex items-center justify-center gap-1 rounded-xl bg-[#2B81FF] hover:bg-[#1E63D6] text-white text-[15px] font-semibold px-4 transition-colors"
          >
            {action.label}
            <ChevronRight className="w-4 h-4" />
          </Link>
        )}
      </div>
    </div>
  );
}
