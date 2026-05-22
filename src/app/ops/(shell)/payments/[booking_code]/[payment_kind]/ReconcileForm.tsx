"use client";

import { useState, useTransition } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { reconcileCustomerAction } from "../../actions";

/**
 * Slim "Link this booking to a customer" form rendered when the booking
 * underlying the current payment has no customer_id. Available to any ops
 * user (reconciliation isn't gated to admins).
 *
 * Accepts the same three lookup forms the rest of /ops uses:
 *   - SAN-C-NNNNN
 *   - full customer UUID
 *   - 10-digit Indian mobile (normalised via lib/phone)
 */
export function ReconcileForm({ bookingId }: { bookingId: string }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("booking_id", bookingId);
      formData.set("customer_lookup", value);
      try {
        const result = await reconcileCustomerAction(formData);
        if (!result?.ok) {
          // Server action threw — but the catch below normalises this.
          setError("Could not link customer.");
          return;
        }
        // Success: the page is force-dynamic + no-store; we don't need
        // to imperatively re-render, the next click / nav fetches fresh.
        // But the action's revalidatePath also forces RSC re-render.
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        setError(e instanceof Error ? e.message : "Could not link customer.");
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="SAN-C-00012 · 9876543210 · or full UUID"
          className="flex-1 min-w-[220px] bg-white border border-amber-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-600 focus:border-transparent"
        />
        <button
          type="button"
          onClick={submit}
          disabled={isPending || !value.trim()}
          className="bg-amber-700 hover:bg-amber-800 disabled:bg-amber-300 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors inline-flex items-center gap-1.5"
        >
          {isPending ? (
            <>Linking…</>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4" />
              Link customer
            </>
          )}
        </button>
      </div>
      {error && (
        <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}
    </div>
  );
}
