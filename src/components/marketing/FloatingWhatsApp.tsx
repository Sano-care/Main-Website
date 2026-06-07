"use client";

// T85 PR3 — restyled floating WhatsApp FAB.
//
// Position, size, and decoration are locked to the v4 mockup:
//   - 52×52 fixed circle
//   - bottom: 96px, right: 14px (clears ServiceStickyBar at 100,
//     no overlap with the safe-area inset)
//   - z-index: 90 (below ServiceStickyBar at 100, above page content)
//   - Two-layer drop shadow + 14% white inner ring (via box-shadow
//     `inset 0 0 0 1.4px rgba(255,255,255,0.14)`)
//   - 2.4s `whatsapp-pulse` outer-ring animation defined in
//     globals.css — kept in CSS so the keyframes stay in the design-
//     system file rather than inlined here
//   - Reads `--color-whatsapp` / `--color-whatsapp-dark` from the new
//     tokens; replaces the T61 inline `#25D366` references
//
// Behaviour kept from T61:
//   - `hidden` prop hides the FAB when a modal overlay is open
//   - Deferred mount until after first paint so LCP isn't blocked
//   - Same wa.me href shape + prefill text
//
// Reduced motion handling moved to the className — when
// `useReducedMotion()` returns true, drop the `animate-whatsapp-pulse`
// class so the ring is static. framer-motion's `animate-pulse` style
// transforms also collapse to a no-op. Net result: respectful of
// `prefers-reduced-motion` without forking the markup.

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

const WHATSAPP_NUMBER = "919711977782"; // E.164 without + (matches Navbar PHONE_TEL)
const PREFILL_MESSAGE = "Hi, I'd like to book a Sanocare visit";

interface FloatingWhatsAppProps {
  /** Hide the button when a modal overlay is open. Default false. */
  hidden?: boolean;
}

export function FloatingWhatsApp({ hidden = false }: FloatingWhatsAppProps) {
  const prefersReducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || hidden) return null;

  const href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(PREFILL_MESSAGE)}`;

  // Compose the static decoration on the anchor itself:
  //   - drop shadow (outer + tight inner-light)
  //   - 14% white inner ring (the `inset` shadow)
  // The pulse ring rides on top via a sibling absolutely-positioned
  // span (the box-shadow keyframes don't fight the static shadow that
  // way). When reduced-motion is on, we skip rendering the pulse span.
  return (
    <motion.a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with us on WhatsApp"
      className="fixed z-[90] inline-flex items-center justify-center w-[52px] h-[52px] rounded-full text-white bg-[color:var(--color-whatsapp)] hover:bg-[color:var(--color-whatsapp-dark)] transition-colors"
      style={{
        bottom: "96px",
        right: "14px",
        // Two-layer outer shadow + 14% inner ring per mockup.
        boxShadow:
          "0 8px 20px rgba(0,0,0,0.18), 0 2px 4px rgba(0,0,0,0.12), inset 0 0 0 1.4px rgba(255,255,255,0.14)",
      }}
      initial={prefersReducedMotion ? false : { scale: 0, opacity: 0 }}
      animate={prefersReducedMotion ? undefined : { scale: 1, opacity: 1 }}
      transition={
        prefersReducedMotion
          ? undefined
          : { type: "spring", stiffness: 260, damping: 22, delay: 0.6 }
      }
      whileTap={prefersReducedMotion ? undefined : { scale: 0.92 }}
    >
      {/* Pulse ring — sibling span so the keyframed box-shadow doesn't
          collide with the static one on the anchor. Sized to match the
          parent and clipped by the anchor's rounded edge. */}
      {!prefersReducedMotion && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            animation: "whatsapp-pulse 2.4s ease-out infinite",
          }}
        />
      )}

      {/* Official WhatsApp glyph — inline SVG so the green pill renders
          with no additional font / icon-set bundle. */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 32 32"
        className="w-7 h-7 relative"
        aria-hidden="true"
        fill="currentColor"
      >
        <path d="M16.003 3C9.376 3 4 8.376 4 15.003c0 2.114.555 4.176 1.61 6.001L4 28l7.146-1.86a11.964 11.964 0 0 0 4.857 1.024h.005C22.633 27.164 28 21.79 28 15.163 28 8.535 22.624 3 16.003 3zm0 21.836a9.873 9.873 0 0 1-5.034-1.378l-.36-.214-4.245 1.105 1.131-4.137-.235-.382a9.829 9.829 0 0 1-1.508-5.235c.003-5.45 4.43-9.872 9.88-9.872 2.64 0 5.117 1.03 6.984 2.9a9.802 9.802 0 0 1 2.894 6.989c-.003 5.45-4.43 9.872-9.881 9.872zm5.42-7.397c-.297-.149-1.76-.868-2.033-.967-.273-.099-.471-.149-.67.149-.198.298-.768.967-.942 1.165-.173.198-.347.224-.644.075-.298-.149-1.257-.464-2.394-1.478-.885-.79-1.482-1.766-1.656-2.063-.173-.298-.018-.46.13-.608.133-.133.297-.347.446-.521.149-.173.198-.297.297-.495.099-.198.05-.372-.025-.521-.075-.149-.67-1.617-.918-2.214-.241-.581-.487-.503-.67-.512-.173-.008-.372-.01-.57-.01-.198 0-.521.074-.794.372-.273.297-1.04 1.016-1.04 2.478 0 1.461 1.064 2.873 1.213 3.07.149.198 2.099 3.205 5.085 4.495.711.307 1.265.491 1.698.628.713.227 1.362.195 1.875.118.572-.086 1.76-.72 2.008-1.413.247-.694.247-1.288.173-1.413-.074-.124-.272-.198-.57-.347z" />
      </svg>
    </motion.a>
  );
}
