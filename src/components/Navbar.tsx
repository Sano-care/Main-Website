"use client";

// T61 navbar. Changes from the pre-T61 version:
//   - Persistent click-to-call phone number (tel:) — a number on desktop, a
//     phone icon button on mobile. Always in the top nav.
//   - "Sign in" pill replacing the Patient Portal outline button (label from
//     CMS, now defaulting to "Sign in"; pill styling per the locked plan-gate).
//   - The inline AnimatePresence dropdown menu is gone; the hamburger now opens
//     the full-screen MobileMenu (B1). MobileMenu is rendered OUTSIDE <header>
//     (alongside the modals) because the scrolled header sets backdrop-blur,
//     which creates a containing block — a fixed child inside it would mis-place.
//   - The gate→modal booking trigger is the shared useBookingFlow hook (same
//     flow, now reusable by the hero, sticky bar, CTA strips and the menu).
//
// BookingModal + BookingGate are still mounted here once and stay store-driven.

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu, Phone } from "lucide-react";
import { Button } from "@/components/ui";
import { BookingModal } from "@/components/BookingModal";
import { BookingGate } from "@/components/booking/BookingGate";
import { MobileMenu } from "@/components/marketing/MobileMenu";
import { useBookingStore } from "@/store/bookingStore";
import { useBookingFlow } from "@/hooks/useBookingFlow";
import { cn } from "@/lib/utils";
import { useCmsSection } from "@/hooks/useCmsSection";
import { useCmsSiteGlobals } from "@/hooks/useCmsSiteGlobals";
import { SHARED_CONTENT } from "@/constants/cms-content";

const PHONE_TEL = "+919711977782";
const PHONE_DISPLAY = "+91 97119 77782";

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Booking modal + OTP gate stay mounted here; the trigger is shared.
  const isModalOpen = useBookingStore((s) => s.isModalOpen);
  const closeModal = useBookingStore((s) => s.closeModal);
  const isGateOpen = useBookingStore((s) => s.isGateOpen);
  const closeGate = useBookingStore((s) => s.closeGate);
  const { requestBooking } = useBookingFlow();

  const { data: navbarCopy } = useCmsSection(
    "shared",
    "navbar",
    SHARED_CONTENT.navbar,
  );
  const siteGlobals = useCmsSiteGlobals();
  const logoAlt =
    siteGlobals?.logoAlt ?? siteGlobals?.companyName ?? navbarCopy.logoAlt;
  const logoSrc = siteGlobals?.logoUrl ?? "/logo.svg";
  const navLinks = navbarCopy.navLinks;

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-40 w-full transition-all duration-300",
          isScrolled
            ? "bg-white/80 backdrop-blur-xl shadow-sm border-b border-slate-100"
            : "bg-surface-light/95 border-b border-slate-100",
        )}
      >
        <div className="mx-auto flex h-16 md:h-20 lg:h-24 max-w-[1400px] items-center justify-between px-4 md:px-6 lg:px-12">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <Image
              src={logoSrc}
              alt={logoAlt}
              width={44}
              height={44}
              className="w-9 h-9 md:w-11 md:h-11"
              priority
            />
            <div className="flex flex-col leading-tight">
              <h2 className="text-xl md:text-2xl font-semibold tracking-tight text-primary">
                {navbarCopy.brandWordmarkPrefix}
                {navbarCopy.brandWordmarkHighlight}
              </h2>
              <span className="hidden sm:inline text-[10px] md:text-[11px] font-mono uppercase tracking-[0.14em] text-[color:var(--color-accent-coral-dark)] mt-0.5">
                Your Health, Our Priority
              </span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex flex-1 justify-end items-center gap-8 lg:gap-10">
            <div className="flex items-center gap-6 lg:gap-8">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm font-medium text-text-main hover:text-primary transition-colors relative group"
                >
                  {link.label}
                  <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-primary transition-all group-hover:w-full" />
                </Link>
              ))}
            </div>
            <div className="flex items-center gap-3">
              {/* Click-to-call — copyable on desktop, dials on mobile. */}
              <a
                href={`tel:${PHONE_TEL}`}
                className="inline-flex items-center gap-2 text-sm font-semibold text-text-main hover:text-primary transition-colors"
                aria-label={`Call Sanocare at ${PHONE_DISPLAY}`}
              >
                <Phone className="w-4 h-4 text-primary" aria-hidden="true" />
                {PHONE_DISPLAY}
              </a>
              <Button
                variant="primary"
                size="md"
                className="rounded-full"
                onClick={requestBooking}
              >
                {navbarCopy.primaryCtaLabel}
              </Button>
              {/* "Sign in" pill — distinct from regular nav links. */}
              <Link
                href="/portal"
                className="inline-flex items-center justify-center rounded-full border border-primary/20 bg-primary/5 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
              >
                {navbarCopy.portalLabel}
              </Link>
            </div>
          </nav>

          {/* Mobile cluster — persistent click-to-call + hamburger. */}
          <div className="flex items-center gap-1 md:hidden">
            <a
              href={`tel:${PHONE_TEL}`}
              aria-label={`Call Sanocare at ${PHONE_DISPLAY}`}
              className="inline-flex items-center justify-center w-11 h-11 rounded-full text-primary hover:bg-primary/5 transition-colors"
            >
              <Phone className="w-5 h-5" aria-hidden="true" />
            </a>
            <button
              type="button"
              className="inline-flex items-center justify-center w-11 h-11 text-text-main"
              onClick={() => setIsMobileMenuOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="w-6 h-6" />
            </button>
          </div>
        </div>
      </header>

      {/* Full-screen mobile menu (B1). Rendered outside <header> so the
          scrolled header's backdrop-blur containing block doesn't trap it. */}
      <MobileMenu
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        onBook={requestBooking}
        navLinks={navLinks}
        signInLabel={navbarCopy.portalLabel}
        signInHref="/portal"
        phoneNumber={PHONE_TEL}
        phoneDisplay={PHONE_DISPLAY}
      />

      <BookingModal isOpen={isModalOpen} onClose={closeModal} />
      <BookingGate
        isOpen={isGateOpen}
        onClose={closeGate}
        onVerified={() => closeGate()}
      />
    </>
  );
}
