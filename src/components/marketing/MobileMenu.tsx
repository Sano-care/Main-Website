"use client";

// T61 mobile menu — full-screen overlay, slides in from the right
// over 250ms, items inside stagger-fade-in (40ms between items) per
// the brief's motion vocabulary.
//
// Replaces the inline AnimatePresence dropdown that lived inside
// Navbar (lines 147–187 of pre-T61 Navbar.tsx). Navbar now just
// renders the hamburger button + wires onClick to open this
// component.
//
// Structure:
//   - Top bar: Sanocare logo + close (×) button
//   - Primary CTA "Book a Visit" at the top (most reachable thumb zone)
//   - Section nav links (Services / Lab Tests / Sign in / About / Contact)
//   - Bottom: phone number + WhatsApp link for backup contact
//
// Tap targets all ≥48×48px per the brief's mobile accessibility rule.
//
// Honors useReducedMotion(): renders static (no slide, no stagger,
// no fade) but still fully functional.

import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X, Phone, ArrowRight, MessageCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";

type NavLink = {
  href: string;
  label: string;
};

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  /** Top-of-menu primary CTA — wires to the booking modal flow. */
  onBook: () => void;
  /** Section nav links displayed in order. */
  navLinks: ReadonlyArray<NavLink>;
  /** "Sign in" / Patient Portal label — already brand-faithful per T61. */
  signInLabel?: string;
  /** href for the Sign in link. T61 leaves this as /portal; T62 wires the redirect. */
  signInHref?: string;
  /** Phone number for the bottom contact strip. */
  phoneNumber?: string;
  /** Display string for the phone (e.g. "+91 97119 77782"). */
  phoneDisplay?: string;
}

const STAGGER_DELAY_MS = 40;

export function MobileMenu({
  isOpen,
  onClose,
  onBook,
  navLinks,
  signInLabel = "Sign in",
  signInHref = "/portal",
  phoneNumber = "+919711977782",
  phoneDisplay = "+91 97119 77782",
}: MobileMenuProps) {
  const prefersReducedMotion = useReducedMotion();

  // Lock body scroll while menu open.
  useEffect(() => {
    if (!isOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [isOpen]);

  // Close on Escape key.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[60] bg-white flex flex-col md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Main navigation menu"
          initial={prefersReducedMotion ? { opacity: 0 } : { x: "100%" }}
          animate={prefersReducedMotion ? { opacity: 1 } : { x: 0 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { x: "100%" }}
          transition={
            prefersReducedMotion
              ? { duration: 0.15 }
              : { duration: 0.25, ease: [0.22, 1, 0.36, 1] }
          }
        >
          {/* Top bar — logo + close button. Both tap targets ≥48×48. */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <Link
              href="/"
              onClick={onClose}
              className="flex items-center gap-2"
              aria-label="Sanocare home"
            >
              <Image
                src="/logo.svg"
                alt="Sanocare"
                width={40}
                height={40}
                className="w-10 h-10"
                priority={false}
              />
              <span className="text-lg font-semibold tracking-tight text-primary">
                Sanocare
              </span>
            </Link>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="inline-flex items-center justify-center w-12 h-12 text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
            >
              <X className="w-6 h-6" aria-hidden="true" />
            </button>
          </div>

          {/* Scrollable middle — primary CTA + section links + sign in. */}
          <div className="flex-1 overflow-y-auto px-4 py-6">
            {/* Primary CTA — always first, thumb-reachable. */}
            <Item delay={0} reduced={prefersReducedMotion}>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onBook();
                }}
                className="w-full inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark text-white font-semibold py-4 rounded-xl text-base shadow-md active:scale-[0.97] transition-all"
              >
                Book a Visit
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </Item>

            {/* Section nav. Each link is its own stagger step. */}
            <nav className="mt-6">
              <ul className="space-y-1">
                {navLinks.map((link, idx) => (
                  <Item key={link.href} delay={(idx + 1) * STAGGER_DELAY_MS} reduced={prefersReducedMotion}>
                    <Link
                      href={link.href}
                      onClick={onClose}
                      className="block py-3 px-4 text-base font-medium text-slate-900 hover:bg-slate-50 rounded-lg transition-colors min-h-[48px] flex items-center"
                    >
                      {link.label}
                    </Link>
                  </Item>
                ))}
              </ul>
            </nav>

            {/* Sign in pill, surfaced prominently per T61 brand direction. */}
            <Item delay={(navLinks.length + 1) * STAGGER_DELAY_MS} reduced={prefersReducedMotion}>
              <Link
                href={signInHref}
                onClick={onClose}
                className="mt-4 w-full inline-flex items-center justify-center bg-primary/5 hover:bg-primary/10 text-primary border border-primary/20 font-medium py-3 px-4 rounded-full text-sm transition-colors min-h-[48px]"
              >
                {signInLabel}
              </Link>
            </Item>
          </div>

          {/* Bottom contact strip — phone + WhatsApp. Always visible. */}
          <div className="border-t border-slate-100 px-4 py-3 flex items-center gap-2">
            <a
              href={`tel:${phoneNumber}`}
              onClick={onClose}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold py-3 rounded-lg text-sm min-h-[48px]"
              aria-label={`Call ${phoneDisplay}`}
            >
              <Phone className="w-4 h-4" aria-hidden="true" />
              Call
            </a>
            <a
              href={`https://wa.me/${phoneNumber.replace(/\D/g, "")}?text=${encodeURIComponent("Hi, I'd like to book a Sanocare visit")}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#1ebe57] text-white font-semibold py-3 rounded-lg text-sm min-h-[48px]"
              aria-label="Open WhatsApp"
            >
              <MessageCircle className="w-4 h-4" aria-hidden="true" />
              WhatsApp
            </a>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface ItemProps {
  delay: number;
  reduced: boolean | null;
  children: React.ReactNode;
}

function Item({ delay, reduced, children }: ItemProps) {
  if (reduced) {
    return <li className="list-none">{children}</li>;
  }
  return (
    <motion.li
      className="list-none"
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        duration: 0.25,
        delay: delay / 1000,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {children}
    </motion.li>
  );
}
