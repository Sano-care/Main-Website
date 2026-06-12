"use client";

// T61 rewrite-in-place per brief: always-visible (not scroll-direction
// gated — that pattern is flakey in WhatsApp WebView), hides on
// keyboard open to avoid covering form inputs, three CTAs (Book a
// Visit primary, Call, WhatsApp).
//
// Pre-T61 behavior was "appear-after-scroll": the bar slid in only
// after the user scrolled past #hero-booking-form. That pattern
// assumed the inline hero form existed; T61 replaces the hero form
// with QuickBookCard, so the gating-element no longer exists. Brief
// also favors always-visible to remove the scroll-event flakiness on
// WebViews.
//
// Keyboard-open detection: visualViewport.height shrinks when the
// soft keyboard opens on iOS Safari + Android Chrome. We compare
// against window.innerHeight; if the visual viewport is <0.75 of the
// window, treat as keyboard-open. Falls back to always-visible on
// browsers without visualViewport (older WebViews).
//
// onBook prop wires to the booking modal flow (BookingGate →
// BookingModal). Caller (page.tsx) passes the Navbar's handleBookClick
// or equivalent.

import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ArrowRight, Phone } from "lucide-react";
import { useEffect, useState } from "react";

import { PHONE_TEL, WHATSAPP_DEEPLINK } from "@/lib/contact";

const WHATSAPP_PREFILL = "Hi, I'd like to book a Sanocare visit";
// Threshold: if the visual viewport shrinks below 75% of the window,
// assume the soft keyboard is up. Empirically robust on iOS Safari
// + Android Chrome; ignored on browsers without visualViewport.
const KEYBOARD_VH_RATIO = 0.75;

interface MobileStickyBarProps {
  /** Wires to the page-level booking modal flow. Optional so this
   *  component compiles standalone — page.tsx passes the real handler
   *  in step 10. Fallback scrolls to top so the user can find a CTA. */
  onBook?: () => void;
}

export function MobileStickyBar({ onBook }: MobileStickyBarProps) {
  const handleBook = () => {
    if (onBook) {
      onBook();
    } else if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const prefersReducedMotion = useReducedMotion();
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  // Defer mount until after first paint to avoid blocking LCP.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return; // older WebViews — always-visible fallback

    const handleResize = () => {
      const ratio = vv.height / window.innerHeight;
      setKeyboardOpen(ratio < KEYBOARD_VH_RATIO);
    };
    vv.addEventListener("resize", handleResize);
    handleResize();
    return () => vv.removeEventListener("resize", handleResize);
  }, []);

  if (!mounted) return null;

  return (
    <AnimatePresence>
      {!keyboardOpen && (
        <motion.div
          className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] px-3 py-3 md:hidden"
          initial={prefersReducedMotion ? false : { y: "100%" }}
          animate={prefersReducedMotion ? undefined : { y: 0 }}
          exit={prefersReducedMotion ? undefined : { y: "100%" }}
          transition={
            prefersReducedMotion
              ? undefined
              : { duration: 0.3, ease: [0.22, 1, 0.36, 1] }
          }
        >
          <div className="flex items-stretch gap-2">
            {/* Primary — Book a Visit (flex-1 so it dominates the bar) */}
            <button
              type="button"
              onClick={handleBook}
              className="flex-1 inline-flex items-center justify-center gap-1.5 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl px-4 py-3 shadow-md active:scale-[0.97] transition-all min-h-[48px]"
            >
              Book a Visit
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>

            {/* Call — emerald */}
            <a
              href={`tel:${PHONE_TEL}`}
              aria-label="Call Sanocare"
              className="inline-flex items-center justify-center w-12 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl active:scale-95 transition-all min-h-[48px]"
            >
              <Phone className="w-5 h-5" aria-hidden="true" />
            </a>

            {/* WhatsApp — brand green */}
            <a
              href={`${WHATSAPP_DEEPLINK}?text=${encodeURIComponent(WHATSAPP_PREFILL)}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Chat on WhatsApp"
              className="inline-flex items-center justify-center w-12 bg-[#25D366] hover:bg-[#1ebe57] text-white rounded-xl active:scale-95 transition-all min-h-[48px]"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 32 32"
                className="w-5 h-5"
                aria-hidden="true"
                fill="currentColor"
              >
                <path d="M16.003 3C9.376 3 4 8.376 4 15.003c0 2.114.555 4.176 1.61 6.001L4 28l7.146-1.86a11.964 11.964 0 0 0 4.857 1.024h.005C22.633 27.164 28 21.79 28 15.163 28 8.535 22.624 3 16.003 3zm0 21.836a9.873 9.873 0 0 1-5.034-1.378l-.36-.214-4.245 1.105 1.131-4.137-.235-.382a9.829 9.829 0 0 1-1.508-5.235c.003-5.45 4.43-9.872 9.88-9.872 2.64 0 5.117 1.03 6.984 2.9a9.802 9.802 0 0 1 2.894 6.989c-.003 5.45-4.43 9.872-9.881 9.872z" />
              </svg>
            </a>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
