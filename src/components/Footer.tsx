"use client";

import Link from "next/link";
import Image from "next/image";
import { MapPin, Phone, Mail } from "lucide-react";
import { useCmsSection } from "@/hooks/useCmsSection";
import { useCmsSiteGlobals } from "@/hooks/useCmsSiteGlobals";
import { SHARED_CONTENT } from "@/constants/cms-content";

export function Footer() {
  const defaultSocialIcon = SHARED_CONTENT.footer.socialLinks[0].icon;
  const defaultTrustIcon = SHARED_CONTENT.footer.trustBadges[0].icon;
  const { data: footerCopy } = useCmsSection(
    "shared",
    "footer",
    SHARED_CONTENT.footer,
  );
  const siteGlobals = useCmsSiteGlobals();
  const footerLinks = footerCopy.links;
  const fallbackSocialLinks = footerCopy.socialLinks.map((social, index) => ({
    ...social,
    icon: social.icon ?? SHARED_CONTENT.footer.socialLinks[index]?.icon ?? defaultSocialIcon,
  }));
  const socialLinks = siteGlobals?.socialLinks?.length
    ? siteGlobals.socialLinks.map((social, index) => ({
        ...social,
        icon:
          fallbackSocialLinks.find(
            (fallbackSocial) =>
              fallbackSocial.label.toLowerCase() === social.label.toLowerCase(),
          )?.icon ?? fallbackSocialLinks[index]?.icon ?? defaultSocialIcon,
      }))
    : fallbackSocialLinks;
  const legalLinks = siteGlobals?.legalLinks?.length
    ? siteGlobals.legalLinks
    : footerLinks.legal;
  const trustBadges = footerCopy.trustBadges.map((badge, index) => ({
    ...badge,
    icon: badge.icon ?? SHARED_CONTENT.footer.trustBadges[index]?.icon ?? defaultTrustIcon,
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
  const brandDescription = siteGlobals?.brandDescription ?? footerCopy.brandDescription;

  return (
    <footer className="bg-surface-light border-t border-slate-200 pt-20 pb-12 relative z-10">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand Column */}
          <div className="flex flex-col gap-6">
            <Link href="/" className="flex items-center gap-2">
              <Image
                src={logoSrc}
                alt={logoAlt}
                width={32}
                height={32}
                className="w-8 h-8"
              />
              <span className="text-xl font-serif font-bold text-text-main">
                {footerCopy.brandWordmarkPrefix}<span className="italic font-normal text-primary">{footerCopy.brandWordmarkHighlight}</span>
              </span>
            </Link>
            <p className="text-sm leading-relaxed text-text-secondary">{brandDescription}</p>
            
            {/* Trust Badges */}
            <div className="flex items-center gap-4 text-xs text-text-secondary">
              {trustBadges.map((badge) => {
                const BadgeIcon = typeof badge.icon === "function" ? badge.icon : defaultTrustIcon;
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
                const SocialIcon = typeof social.icon === "function" ? social.icon : defaultSocialIcon;
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
              {footerLinks.services.map((link) => (
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

        {/* Bottom Bar */}
        <div className="mt-20 flex flex-col items-center justify-between gap-6 border-t border-slate-100 pt-8 text-sm text-text-secondary md:flex-row">
          <p>{footerCopy.copyright}</p>
          <div className="flex gap-8">
            {legalLinks.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-primary transition-colors">
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
