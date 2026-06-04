"use client";

// T61 floating WhatsApp button — bottom-right, persistent across all
// viewport sizes. Opens WhatsApp web/app with a pre-filled message.
//
// Coexists with FloatingSidebar (desktop-only vertical icon rail on
// the RIGHT edge, vertical-center) by anchoring to the bottom-right
// instead of the right-center. Different anchor, no overlap.
//
// On mobile, sits above the sticky bottom CTA bar (z-stack:
// MobileStickyBar bottom: 0 z-50, FloatingWhatsApp bottom: 88px z-50
// — sits clear of the sticky bar plus a small visual gap).
//
// Hides while the BookingModal or any other modal-overlay surface is
// open (parent controls visibility via the `hidden` prop). Default
// always visible.

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

const WHATSAPP_NUMBER = "919711977782"; // E.164 without +
const PREFILL_MESSAGE = "Hi, I'd like to book a Sanocare visit";

interface FloatingWhatsAppProps {
  /** Hide the button when a modal overlay is open. Default false. */
  hidden?: boolean;
}

export function FloatingWhatsApp({ hidden = false }: FloatingWhatsAppProps) {
  const prefersReducedMotion = useReducedMotion();
  // Defer mount until after first paint to avoid blocking LCP. Also
  // gives mobile keyboard-open detectors a clean baseline.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || hidden) return null;

  const href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(PREFILL_MESSAGE)}`;

  return (
    <motion.a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with us on WhatsApp"
      className="fixed bottom-24 right-4 sm:bottom-6 sm:right-6 z-50 inline-flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 bg-[#25D366] hover:bg-[#1ebe57] text-white rounded-full shadow-2xl ring-4 ring-white/60"
      initial={prefersReducedMotion ? false : { scale: 0, opacity: 0 }}
      animate={prefersReducedMotion ? undefined : { scale: 1, opacity: 1 }}
      transition={
        prefersReducedMotion
          ? undefined
          : { type: "spring", stiffness: 260, damping: 22, delay: 0.6 }
      }
      whileTap={prefersReducedMotion ? undefined : { scale: 0.92 }}
    >
      {/* WhatsApp glyph — inline SVG so the green pill renders with no
          additional font / icon-set bundle. */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 32 32"
        className="w-7 h-7 sm:w-8 sm:h-8"
        aria-hidden="true"
        fill="currentColor"
      >
        <path d="M16.003 3C9.376 3 4 8.376 4 15.003c0 2.114.555 4.176 1.61 6.001L4 28l7.146-1.86a11.964 11.964 0 0 0 4.857 1.024h.005C22.633 27.164 28 21.79 28 15.163 28 8.535 22.624 3 16.003 3zm0 21.836a9.873 9.873 0 0 1-5.034-1.378l-.36-.214-4.245 1.105 1.131-4.137-.235-.382a9.829 9.829 0 0 1-1.508-5.235c.003-5.45 4.43-9.872 9.88-9.872 2.64 0 5.117 1.03 6.984 2.9a9.802 9.802 0 0 1 2.894 6.989c-.003 5.45-4.43 9.872-9.881 9.872zm5.42-7.397c-.297-.149-1.76-.868-2.033-.967-.273-.099-.471-.149-.67.149-.198.298-.768.967-.942 1.165-.173.198-.347.224-.644.075-.298-.149-1.257-.464-2.394-1.478-.885-.79-1.482-1.766-1.656-2.063-.173-.298-.018-.46.13-.608.133-.133.297-.347.446-.521.149-.173.198-.297.297-.495.099-.198.05-.372-.025-.521-.075-.149-.67-1.617-.918-2.214-.241-.581-.487-.503-.67-.512-.173-.008-.372-.01-.57-.01-.198 0-.521.074-.794.372-.273.297-1.04 1.016-1.04 2.478 0 1.461 1.064 2.873 1.213 3.07.149.198 2.099 3.205 5.085 4.495.711.307 1.265.491 1.698.628.713.227 1.362.195 1.875.118.572-.086 1.76-.72 2.008-1.413.247-.694.247-1.288.173-1.413-.074-.124-.272-.198-.57-.347z" />
      </svg>
    </motion.a>
  );
}
