"use client";

import { useState, useTransition } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { issueRefundAction } from "../../actions";

type Props = {
  bookingId: string;
  paymentKind: "booking_fee" | "report_fee";
  refundablePaise: number;
  bookingCode: string;
};

type Phase =
  | { kind: "idle" }
  | { kind: "confirming"; amountRupees: string; reason: string }
  | { kind: "done"; refundId: string; amountPaise: number; isPartial: boolean; status: string };

/**
 * Two-step refund issuing UI.
 *
 *   1. Compose: amount (defaults to the full refundable balance) + reason.
 *   2. Confirm: a clear "₹X to booking SAN-B-Y — confirm?" panel before
 *      anything is sent to Razorpay.
 *   3. Submit: the server action re-checks is_ops_admin(), calls Razorpay,
 *      upserts the refunds row, mirrors the legacy bookings columns.
 *
 * Errors come back in the action's return value (RefundError → friendly
 * string) and render inline; no error boundary trip.
 */
export function RefundForm({
  bookingId,
  paymentKind,
  refundablePaise,
  bookingCode,
}: Props) {
  const refundableRupees = (refundablePaise / 100).toFixed(2);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Compose state, kept locally so it survives the confirm-step toggle.
  const [amountRupees, setAmountRupees] = useState(refundableRupees);
  const [reason, setReason] = useState("");

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("booking_id", bookingId);
      formData.set("payment_kind", paymentKind);
      // Empty value = full refund. The server action treats "" as null.
      // Always submit the typed value even when equal to refundable —
      // the server is the source of truth for the cap.
      if (amountRupees) formData.set("amount_rupees", amountRupees);
      if (reason) formData.set("reason", reason);
      formData.set("confirmed", "yes");

      const result = await issueRefundAction(formData);
      if (!result || result.ok === false) {
        setError(result?.error ?? "Refund failed");
        setPhase({ kind: "confirming", amountRupees, reason });
        return;
      }
      setPhase({
        kind: "done",
        refundId: result.refundId,
        amountPaise: result.refundedAmountPaise,
        isPartial: result.isPartial,
        status: result.refundStatus,
      });
    });
  };

  // ===== Done =====
  if (phase.kind === "done") {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <div className="font-semibold text-emerald-800">
              Refund {phase.isPartial ? "partially " : ""}issued ·{" "}
              ₹{(phase.amountPaise / 100).toLocaleString("en-IN")}
            </div>
            <div className="text-emerald-700 mt-0.5">
              Razorpay refund id:{" "}
              <span className="font-mono">{phase.refundId}</span> · status{" "}
              <span className="font-mono">{phase.status}</span>
              {phase.status === "pending" && (
                <>
                  {" "}
                  — settlement can take a few business days. The webhook will
                  flip this to <span className="font-mono">processed</span>{" "}
                  automatically.
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===== Confirm =====
  if (phase.kind === "confirming") {
    const amountForDisplay = amountRupees || refundableRupees;
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div className="text-[11px] font-mono uppercase tracking-wider text-amber-800 mb-2">
          Confirm refund
        </div>
        <p className="text-sm text-amber-900 mb-4">
          You&apos;re about to refund{" "}
          <span className="font-semibold">₹{Number(amountForDisplay).toLocaleString("en-IN")}</span>{" "}
          on booking{" "}
          <span className="font-mono">{bookingCode}</span>{" "}
          ({paymentKind === "booking_fee" ? "booking fee" : "report fee"}).
          This calls Razorpay immediately — the patient&apos;s money moves on
          submit.
        </p>
        {reason && (
          <div className="mb-4 text-sm text-amber-900">
            <span className="font-semibold">Reason:</span> {reason}
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-3 py-2 mb-3">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>{error}</div>
          </div>
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={isPending}
            className="bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            {isPending ? "Issuing…" : "Confirm refund"}
          </button>
          <button
            type="button"
            onClick={() => {
              setPhase({ kind: "idle" });
              setError(null);
            }}
            disabled={isPending}
            className="text-sm text-slate-600 hover:text-slate-900 disabled:opacity-50"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  // ===== Compose =====
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-xs font-medium text-slate-700 mb-1">
            Amount (₹)
          </span>
          <input
            type="number"
            min={0.01}
            max={refundablePaise / 100}
            step="0.01"
            value={amountRupees}
            onChange={(e) => setAmountRupees(e.target.value)}
            className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
          />
          <span className="block text-[11px] text-slate-500 mt-1">
            Defaults to the full refundable balance · max ₹
            {(refundablePaise / 100).toLocaleString("en-IN")}.
          </span>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-700 mb-1">
            Reason (recorded on Razorpay + refunds row)
          </span>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="E.g. sample rejected by Pathcore"
            className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
          />
        </label>
      </div>
      <button
        type="button"
        onClick={() => {
          const n = Number(amountRupees);
          if (!Number.isFinite(n) || n <= 0) {
            setError("Enter a positive amount.");
            return;
          }
          if (n * 100 > refundablePaise) {
            setError(
              `Amount exceeds the refundable balance of ₹${(refundablePaise / 100).toLocaleString("en-IN")}.`,
            );
            return;
          }
          setError(null);
          setPhase({ kind: "confirming", amountRupees, reason });
        }}
        className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
      >
        Review refund
      </button>
      {error && (
        <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}
    </div>
  );
}
