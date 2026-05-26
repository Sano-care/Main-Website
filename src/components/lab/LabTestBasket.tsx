"use client";

import { useEffect, useState } from "react";
import {
  ShoppingBag,
  X,
  Tag,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { useBookingStore } from "@/store/bookingStore";
import type { AppliedCoupon } from "@/types/lab-coupon";
import { PathcoreCoBrandStrip } from "@/components/PathcoreCoBrandStrip";

interface Props {
  /** When true, basket renders as a sticky right-rail panel (desktop).
   *  Otherwise, renders as a bottom drawer (mobile). */
  variant?: "rail" | "drawer";
}

/**
 * Lab test basket — sticky right-rail on desktop, bottom drawer on mobile.
 *
 * Lists the tests the patient has added via LabTestSearch, shows running
 * subtotal, accepts a coupon code, and CTAs into the booking form (which
 * opens the existing BookingModal pre-set to serviceCategory='diagnostics').
 */
export function LabTestBasket({ variant = "rail" }: Props) {
  const {
    selectedTests,
    removeSelectedTest,
    clearSelectedTests,
    openModal,
    openGate,
    phoneVerifiedUntil,
    setDetails,
    appliedCoupon,
    setAppliedCoupon,
    clearAppliedCoupon,
  } = useBookingStore();
  const isPhoneVerified =
    phoneVerifiedUntil !== null && phoneVerifiedUntil > Date.now();
  const [pendingOpenModal, setPendingOpenModal] = useState(false);

  // Resume opening the booking modal once the gate has verified.
  useEffect(() => {
    if (pendingOpenModal && isPhoneVerified) {
      setPendingOpenModal(false);
      openModal();
    }
  }, [pendingOpenModal, isPhoneVerified, openModal]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "ok" | "err";
    msg: string;
  } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const subtotalInr = selectedTests.reduce((s, t) => s + (t.price || 0), 0);
  const finalInr = appliedCoupon ? appliedCoupon.final_inr : subtotalInr;
  const discountInr = appliedCoupon?.discount_inr ?? 0;

  async function handleApplyCoupon(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/lab/validate-coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), subtotalInr }),
      });
      const data = await res.json();
      if (data.ok) {
        const applied: AppliedCoupon = {
          code: data.code,
          discount_percent: data.discountPercent,
          discount_inr: data.discountInr,
          final_inr: data.finalInr,
          description: data.description,
        };
        setAppliedCoupon(applied);
        setFeedback({
          type: "ok",
          msg: `${data.discountPercent}% off applied · you save ₹${data.discountInr.toLocaleString(
            "en-IN"
          )}`,
        });
      } else {
        setFeedback({ type: "err", msg: data.error || "Coupon invalid" });
      }
    } catch {
      setFeedback({
        type: "err",
        msg: "Couldn't validate the coupon. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  function handleRemoveCoupon() {
    clearAppliedCoupon();
    setCode("");
    setFeedback(null);
  }

  function handleProceed() {
    setDetails({ serviceCategory: "diagnostics" });
    if (isPhoneVerified) {
      openModal();
    } else {
      setPendingOpenModal(true);
      openGate();
    }
  }

  const isEmpty = selectedTests.length === 0;

  // ===== Mobile bottom drawer trigger =====
  if (variant === "drawer") {
    return (
      <>
        {/* Floating mobile pill — only visible if basket has items */}
        {!isEmpty && (
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="fixed bottom-20 right-4 z-30 inline-flex items-center gap-2 bg-[color:var(--color-accent-coral)] hover:bg-[color:var(--color-accent-coral-dark)] text-white font-semibold px-4 py-3 rounded-full shadow-lg md:hidden"
          >
            <ShoppingBag className="w-4 h-4" />
            {selectedTests.length} test{selectedTests.length === 1 ? "" : "s"}
            <span className="font-bold ml-1">
              ₹{finalInr.toLocaleString("en-IN")}
            </span>
          </button>
        )}

        {/* Drawer overlay */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-ink/40 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* Drawer */}
        <div
          className={
            "fixed left-0 right-0 bottom-0 z-50 bg-white rounded-t-3xl shadow-2xl md:hidden transition-transform duration-300 " +
            (mobileOpen ? "translate-y-0" : "translate-y-full")
          }
          style={{ maxHeight: "85vh", overflowY: "auto" }}
        >
          <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-primary" />
              <span className="font-semibold text-text-main">Your basket</span>
              <span className="text-text-secondary text-sm">
                ({selectedTests.length})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="p-2 -mr-2 text-text-secondary"
              aria-label="Close basket"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-5">
            <BasketContents
              selectedTests={selectedTests}
              removeSelectedTest={removeSelectedTest}
              clearSelectedTests={clearSelectedTests}
              subtotalInr={subtotalInr}
              finalInr={finalInr}
              discountInr={discountInr}
              appliedCoupon={appliedCoupon}
              code={code}
              setCode={setCode}
              busy={busy}
              feedback={feedback}
              onApplyCoupon={handleApplyCoupon}
              onRemoveCoupon={handleRemoveCoupon}
              onProceed={() => {
                setMobileOpen(false);
                handleProceed();
              }}
            />
          </div>
        </div>
      </>
    );
  }

  // ===== Desktop sticky right rail =====
  return (
    <aside className="hidden md:block sticky top-28 self-start">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 bg-gradient-to-br from-primary-50 to-white">
          <div className="flex items-center gap-2 mb-1">
            <ShoppingBag className="w-5 h-5 text-primary" />
            <span className="font-semibold text-text-main">Your basket</span>
            {selectedTests.length > 0 && (
              <span className="ml-auto text-xs font-mono uppercase tracking-wider text-text-secondary">
                {selectedTests.length} test
                {selectedTests.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <p className="text-xs text-text-secondary">
            Free home collection · Pay only after report is ready
          </p>
        </div>
        <div className="p-5">
          <BasketContents
            selectedTests={selectedTests}
            removeSelectedTest={removeSelectedTest}
            clearSelectedTests={clearSelectedTests}
            subtotalInr={subtotalInr}
            finalInr={finalInr}
            discountInr={discountInr}
            appliedCoupon={appliedCoupon}
            code={code}
            setCode={setCode}
            busy={busy}
            feedback={feedback}
            onApplyCoupon={handleApplyCoupon}
            onRemoveCoupon={handleRemoveCoupon}
            onProceed={handleProceed}
          />
        </div>
      </div>
    </aside>
  );
}

// ===== Shared body — used by both rail and drawer =====
interface ContentsProps {
  selectedTests: ReturnType<typeof useBookingStore.getState>["selectedTests"];
  removeSelectedTest: (code: string) => void;
  clearSelectedTests: () => void;
  subtotalInr: number;
  finalInr: number;
  discountInr: number;
  appliedCoupon: AppliedCoupon | null;
  code: string;
  setCode: (v: string) => void;
  busy: boolean;
  feedback: { type: "ok" | "err"; msg: string } | null;
  onApplyCoupon: (e: React.FormEvent) => void;
  onRemoveCoupon: () => void;
  onProceed: () => void;
}

function BasketContents({
  selectedTests,
  removeSelectedTest,
  clearSelectedTests,
  subtotalInr,
  finalInr,
  discountInr,
  appliedCoupon,
  code,
  setCode,
  busy,
  feedback,
  onApplyCoupon,
  onRemoveCoupon,
  onProceed,
}: ContentsProps) {
  if (selectedTests.length === 0) {
    return (
      <div className="text-center py-6">
        <ShoppingBag className="w-10 h-10 text-text-secondary mx-auto mb-3 opacity-40" />
        <p className="text-sm text-text-secondary mb-4">
          Your basket is empty. Search and add tests from above to see prices.
        </p>
        <PathcoreCoBrandStrip variant="compact" />
      </div>
    );
  }

  return (
    <>
      {/* Pathcore co-brand credit — names the processing lab inside
          the diagnostics basket. Same line on rail + drawer. */}
      <div className="mb-3">
        <PathcoreCoBrandStrip variant="compact" />
      </div>

      {/* Test list */}
      <ul className="space-y-2.5 mb-4">
        {selectedTests.map((t) => (
          <li
            key={t.code}
            className="flex items-start justify-between gap-3 text-sm"
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium text-text-main leading-tight">
                {t.name}
              </div>
              <div className="text-xs text-text-secondary mt-0.5">
                <span className="font-mono">{t.code}</span>
                {t.tat ? <> · {t.tat}</> : null}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-text-main font-semibold">
                ₹{t.price.toLocaleString("en-IN")}
              </span>
              <button
                type="button"
                onClick={() => removeSelectedTest(t.code)}
                className="p-1 text-text-secondary hover:text-rose-600 transition-colors"
                aria-label={`Remove ${t.name}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="border-t border-slate-100 pt-3 mb-3 space-y-1.5 text-sm">
        <div className="flex justify-between text-text-secondary">
          <span>Subtotal</span>
          <span>₹{subtotalInr.toLocaleString("en-IN")}</span>
        </div>
        {appliedCoupon && (
          <div className="flex justify-between text-[color:var(--color-accent-coral-dark)] font-medium">
            <span>
              {appliedCoupon.code} · {appliedCoupon.discount_percent}% off
            </span>
            <span>− ₹{discountInr.toLocaleString("en-IN")}</span>
          </div>
        )}
        <div className="flex justify-between text-text-main pt-1 mt-1 border-t border-slate-100 font-bold text-base">
          <span>Total payable (after report)</span>
          <span>₹{finalInr.toLocaleString("en-IN")}</span>
        </div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary pt-1">
          ₹0 charged at booking · paid after report is ready
        </div>
      </div>

      {/* Coupon */}
      {!appliedCoupon ? (
        <form onSubmit={onApplyCoupon} className="mb-3">
          <label className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-text-secondary mb-1.5">
            <Tag className="w-3 h-3" />
            Have a coupon?
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. LAUNCH10"
              className="flex-1 px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 uppercase"
              maxLength={32}
            />
            <button
              type="submit"
              disabled={busy || !code.trim()}
              className="px-3.5 py-2 text-sm font-semibold bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Apply"}
            </button>
          </div>
          {feedback && (
            <div
              className={
                "mt-2 text-xs flex items-start gap-1.5 " +
                (feedback.type === "ok" ? "text-emerald-700" : "text-rose-600")
              }
            >
              {feedback.type === "ok" ? (
                <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              )}
              <span>{feedback.msg}</span>
            </div>
          )}
        </form>
      ) : (
        <div className="mb-3 p-3 bg-[color:var(--color-accent-coral-50)] border border-[color:var(--color-accent-coral)] rounded-lg flex items-start justify-between gap-2">
          <div className="text-xs">
            <div className="font-semibold text-[color:var(--color-accent-coral-dark)] mb-0.5">
              {appliedCoupon.code} applied
            </div>
            <div className="text-text-secondary">
              You save ₹{discountInr.toLocaleString("en-IN")} (
              {appliedCoupon.discount_percent}%)
            </div>
          </div>
          <button
            type="button"
            onClick={onRemoveCoupon}
            className="p-1 text-text-secondary hover:text-rose-600 transition-colors shrink-0"
            aria-label="Remove coupon"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* CTAs */}
      <button
        type="button"
        onClick={onProceed}
        className="w-full inline-flex items-center justify-center gap-2 bg-[color:var(--color-accent-coral)] hover:bg-[color:var(--color-accent-coral-dark)] text-white font-semibold px-4 py-3 rounded-xl transition-colors shadow-md"
      >
        Proceed to book collection
        <ChevronRight className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={clearSelectedTests}
        className="w-full mt-2 text-xs text-text-secondary hover:text-rose-600 transition-colors"
      >
        Clear basket
      </button>
    </>
  );
}
