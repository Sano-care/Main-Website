"use client";

import Link from "next/link";
import Image from "next/image";
import { MapPin, Phone, Mail } from "lucide-react";
import { useCmsSection } from "@/hooks/useCmsSection";
import { useCmsSiteGlobals } from "@/hooks/useCmsSiteGlobals";
import { SHARED_CONTENT } from "@/constants/cms-content";
import { isReactComponent } from "@/services/cms/snapshot";

// Nursing-only corporate bio for the Google-Ads classifier-safe footer
// variant — strips "doctor / MBBS / diagnose / prescribe / telemedicine".
const CLASSIFIER_SAFE_BIO =
  "Sanocare provides professional doorstep nursing assistance, vital monitoring logs, and premium home-care coordination for urban families. Our qualified, background-verified professionals deliver on-demand physical care support and health tracking right to your residence on your timeline.";

// Service links dropped from the classifier-safe footer variant — the two
// telemedicine destinations Google Ads' healthcare classifier flags.
const CLASSIFIER_SAFE_EXCLUDED_LINKS = new Set([
  "/services/doctor-home-visit-delhi",
  "/services/online-doctor-consultation-india",
]);

export function Footer({
  variant = "default",
}: {
  /**
   * "classifier-safe" swaps the doctor-led bio for a nursing-only one and
   * drops the two telemedicine service links, so the page can serve as a
   * Google Ads landing destination without tripping the healthcare-services
   * classifier. ONLY /services/home-nurse-delhi-ncr passes this today; every
   * other page renders the default footer unchanged.
   */
  variant?: "default" | "classifier-safe";
} = {}) {
  const defaultSocialIcon = SHARED_CONTENT.footer.socialLinks[0].icon;
  const defaultTrustIcon = SHARED_CONTENT.footer.trustBadges[0].icon;
  const { data: footerCopy } = useCmsSection(
    "shared",
    "footer",
    SHARED_CONTENT.footer,
  );
  const siteGlobals = useCmsSiteGlobals();
  const footerLinks = footerCopy.links;
  // Classifier-safe variant drops the two telemedicine service links.
  const serviceLinks =
    variant === "classifier-safe"
      ? footerLinks.services.filter(
          (l: { href: string }) => !CLASSIFIER_SAFE_EXCLUDED_LINKS.has(l.href),
        )
      : footerLinks.services;
  // Match a CMS-supplied social link to its constant counterpart by host (most
  // robust — labels and exact hrefs drift, but the social-network host doesn't).
  // Falls back to position. Used only for icon resolution.
  const hostOf = (href: string) => {
    try {
      return new URL(href).host.replace(/^www\./, "");
    } catch {
      return "";
    }
  };
  const constantSocialLinks = SHARED_CONTENT.footer.socialLinks;
  // lucide-react icons are forwardRef components, so `typeof === "function"`
  // returns false. Use `isReactComponent` so a genuine icon is kept and a
  // CMS-serialised `{}` falls through to the position-aware constant.
  const fallbackSocialLinks = footerCopy.socialLinks.map((social, index) => ({
    ...social,
    icon: isReactComponent(social.icon)
      ? social.icon
      : (constantSocialLinks[index]?.icon ?? defaultSocialIcon),
  }));
  const socialLinks = siteGlobals?.socialLinks?.length
    ? siteGlobals.socialLinks.map((social, index) => {
        const targetHost = hostOf(social.href);
        const hostMatch = targetHost
          ? constantSocialLinks.find((c) => hostOf(c.href) === targetHost)
          : undefined;
        return {
          ...social,
          icon:
            hostMatch?.icon ??
            constantSocialLinks[index]?.icon ??
            defaultSocialIcon,
        };
      })
    : fallbackSocialLinks;
  const legalLinks = siteGlobals?.legalLinks?.length
    ? siteGlobals.legalLinks
    : footerLinks.legal;
  const trustBadges = footerCopy.trustBadges.map((badge, index) => ({
    ...badge,
    icon: isReactComponent(badge.icon)
      ? badge.icon
      : (SHARED_CONTENT.footer.trustBadges[index]?.icon ?? defaultTrustIcon),
  }));
  const contactPhone = siteGlobals?.phonePrimary ?? footerCopy.contact.phone;
  const contactPhoneHref = siteGlobals?.phonePrimary
    ? `tel:${siteGlobals.phonePrimary.replace(/[^+\d]/g, "")}`
    : footerCopy.contact.phoneHref;
  const contactEmail = siteGlobals?.emailPrimary ?? footerCopy.contact.email;
  const contactEmailHref = siteGlobals?.emailPrimary
    ? `mailto:${siteGlobals.emailPrimary}`
    : footerCopy.contact.emailHref;
  const addressLine1 = siteGlobals?.addressLine1 ?? footerCopy.contact.addressLines[0];
  const addressLine2 = siteGlobals?.addressLine2 ?? footerCopy.contact.addressLines[1];
  const mapsHref = siteGlobals?.mapsUrl ?? footerCopy.contact.mapsHref;
  const logoSrc = siteGlobals?.logoUrl ?? "/logo.svg";
  const logoAlt = siteGlobals?.logoAlt ?? siteGlobals?.companyName ?? footerCopy.logoAlt;
  const brandDescription =
    variant === "classifier-safe"
      ? CLASSIFIER_SAFE_BIO
      : (siteGlobals?.brandDescription ?? footerCopy.brandDescription);
  const legalStripFallback = SHARED_CONTENT.footer.legalStrip;
  const legalStrip = {
    emergencyDisclaimer:
      footerCopy.legalStrip?.emergencyDisclaimer ?? legalStripFallback.emergencyDisclaimer,
    legalEntity: footerCopy.legalStrip?.legalEntity ?? legalStripFallback.legalEntity,
    cin: footerCopy.legalStrip?.cin ?? legalStripFallback.cin,
    registeredOffice:
      footerCopy.legalStrip?.registeredOffice ?? legalStripFallback.registeredOffice,
    grievanceOfficer:
      footerCopy.legalStrip?.grievanceOfficer ?? legalStripFallback.grievanceOfficer,
  };

  return (
    <footer className="bg-surface-light border-t border-slate-200 pt-20 pb-12 relative z-10">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand Column — single-word wordmark + coral tagline strip */}
          <div className="flex flex-col gap-6">
            <Link href="/" className="flex items-center gap-3 w-fit">
              <Image
                src={logoSrc}
                alt={logoAlt}
                width={36}
                height={36}
                className="w-9 h-9"
              />
              <div className="flex flex-col leading-tight">
                <span className="text-xl font-semibold tracking-tight text-primary">
                  {footerCopy.brandWordmarkPrefix}
                  {footerCopy.brandWordmarkHighlight}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-[color:var(--color-accent-coral-dark)] mt-0.5">
                  Your Health, Our Priority
                </span>
              </div>
            </Link>
            <p className="text-sm leading-relaxed text-text-secondary">{brandDescription}</p>

            {/* Trust Badges */}
            <div className="flex items-center gap-4 text-xs text-text-secondary">
              {trustBadges.map((badge) => {
                const BadgeIcon = badge.icon;
                return (
                  <span key={badge.label} className="flex items-center gap-1">
                    <BadgeIcon className="w-4 h-4 text-green-600" />
                    {badge.label}
                  </span>
                );
              })}
            </div>

            <div className="flex gap-4">
              {socialLinks.map((social) => {
                const SocialIcon = social.icon;
                return (
                  <a
                    key={social.label}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={social.label}
                    className="flex size-10 items-center justify-center rounded-full bg-slate-100 text-text-secondary hover:bg-primary hover:text-white transition-all"
                  >
                    <SocialIcon className="w-4 h-4" />
                  </a>
                );
              })}
            </div>
          </div>

          {/* Services */}
          <div>
            <h4 className="mb-6 text-sm font-bold uppercase tracking-widest text-text-main">
              Our Services
            </h4>
            <ul className="flex flex-col gap-3 text-sm text-text-secondary">
              {serviceLinks.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="hover:text-primary transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="mb-6 text-sm font-bold uppercase tracking-widest text-text-main">
              Quick Links
            </h4>
            <ul className="flex flex-col gap-3 text-sm text-text-secondary">
              {footerLinks.resources.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="hover:text-primary transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="mb-6 text-sm font-bold uppercase tracking-widest text-text-main">
              Get in Touch
            </h4>
            <ul className="flex flex-col gap-4 text-sm text-text-secondary">
              <li className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <a
                  href={mapsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary transition-colors"
                >
                  {addressLine1}, <br />
                  {addressLine2}
                </a>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="w-5 h-5 text-primary shrink-0" />
                <a href={contactPhoneHref} className="hover:text-primary transition-colors">{contactPhone}</a>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-primary shrink-0" />
                <a href={contactEmailHref} className="hover:text-primary transition-colors">{contactEmail}</a>
              </li>
            </ul>
          </div>
        </div>

        {/* Emergency boundary strip — voice anchor from the project state doc */}
        <div className="mt-16 rounded-2xl border border-[color:var(--color-accent-coral)]/30 bg-[color:var(--color-accent-coral-50)] px-5 py-4 text-xs text-text-main leading-relaxed">
          <strong className="text-[color:var(--color-accent-coral-dark)]">
            {legalStrip.emergencyDisclaimer.split(".")[0]}.
          </strong>{" "}
          {legalStrip.emergencyDisclaimer.split(".").slice(1).join(".").trim()}
        </div>

        {/* Bottom Bar */}
        <div className="mt-10 flex flex-col items-center justify-between gap-6 border-t border-slate-100 pt-8 text-sm text-text-secondary md:flex-row">
          <p>{footerCopy.copyright}</p>
          <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {legalLinks.map((link) => (
              <li key={link.label}>
                <Link
                  href={link.href}
                  className="hover:text-primary transition-colors"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            {/* Manage cookies — re-opens the DPDP consent preferences
                modal regardless of prior consent. Dispatches a window
                event picked up by <ConsentRoot/> mounted globally in
                the root layout. The Footer itself only renders on
                marketing surfaces, so this link is moot on /c/,
                /doctor/, /ops/, /rx/, /portal/ — which is fine: those
                surfaces never expected analytics in the first place
                and the user can still adjust consent by returning to
                any marketing page. */}
            <li>
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(new Event("sano:openConsent"));
                  }
                }}
                className="hover:text-primary transition-colors"
              >
                Manage cookies
              </button>
            </li>
            {/* Sanocare staff Android app (OTP-gated to medics). Plain anchor —
                /download/medic 302-redirects to the public APK in Supabase
                Storage, so we don't want Next to prefetch the redirect. Staff
                label keeps patients from mistaking it for a patient app. */}
            <li>
              <a
                href="/download/medic"
                className="hover:text-primary transition-colors"
              >
                Download Medic App (Sanocare staff)
              </a>
            </li>
          </ul>
        </div>

        {/* Legal entity strip — CIN, registered office, grievance officer */}
        <div className="mt-6 text-[11px] leading-relaxed text-text-secondary text-center md:text-left">
          <span className="font-medium">{legalStrip.legalEntity}</span>
          {" · "}CIN {legalStrip.cin}
          {" · "}Registered office: {legalStrip.registeredOffice}
          <br />
          Grievance officer: {legalStrip.grievanceOfficer}
        </div>
      </div>
    </footer>
  );
}
