import {
  Calendar,
  CheckCircle,
  Facebook,
  Instagram,
  Linkedin,
  MessageCircle,
  Phone,
  Rocket,
  Shield,
  User,
  UserCheck,
} from "lucide-react";

export const SHARED_CONTENT = {
  topBannerAnnouncements: [
    {
      icon: Rocket,
      text: "Sanocare Pulse is in closed beta. Request your cohort invite →",
      highlight: "Sanocare Pulse",
    },
    {
      icon: CheckCircle,
      text: "Now serving Kalkaji & Govindpuri Extension in under 30 minutes.",
      highlight: "under 30 minutes",
    },
    {
      icon: Phone,
      text: "Not an emergency service. For chest pain, breathlessness, or trauma call 112.",
      highlight: "112",
    },
  ],
  navbar: {
    // Single-word, single-colour minimalist wordmark.
    brandWordmarkPrefix: "Sanocare",
    brandWordmarkHighlight: "",
    navLinks: [
      { href: "/services", label: "Services" },
      { href: "/sanopulse", label: "Sanocare Pulse" },
      { href: "/research", label: "Insights" },
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact" },
    ],
    primaryCtaLabel: "Book a visit",
    // T61: "Patient Portal" → "Sign in". This is the in-code DEFAULT; the live
    // CMS may still carry a "Patient Portal" override that must be flipped on
    // prod post-deploy (flagged in the PR description). href stays /portal until
    // the T62 /portal→/pulse redirect ships.
    portalLabel: "Sign in",
    logoAlt: "Sanocare",
  },
  floatingSidebar: {
    buttons: [
      { icon: Calendar, label: "Book", href: "/book" },
      { icon: Phone, label: "Call", href: "tel:+919711977782" },
      { icon: MessageCircle, label: "WhatsApp", href: "https://wa.me/919711977782" },
    ],
    portal: { icon: User, label: "Portal", href: "/portal" },
  },
  mobileStickyBar: {
    callLabel: "Call",
    callHref: "tel:+919711977782",
    bookLabel: "Book a visit",
  },
  footer: {
    brandName: "Sanocare",
    brandWordmarkPrefix: "Sanocare",
    brandWordmarkHighlight: "",
    logoAlt: "Sanocare",
    brandDescription:
      "Doctor-led primary healthcare for urban families. A GNM / B.Sc Nursing-qualified medic arrives in under 30 minutes to execute the visit; a dedicated MBBS doctor joins on live video to diagnose, prescribe, and classify risk per MoHFW Telemedicine Practice Guidelines 2020. Sanocare NOW (on-demand) + CareHub (in-society) + Pulse (intelligence).",
    trustBadges: [
      { icon: UserCheck, label: "GNM / B.Sc Nursing medics · MBBS doctors" },
      { icon: Shield, label: "DPDP 2023 compliant" },
    ],
    links: {
      services: [
        { label: "Home visit (from ₹499)", href: "/services#homecare" },
        { label: "Nursing-only (from ₹199)", href: "/services#nursing" },
        { label: "Teleconsultation (from ₹399)", href: "/services#teleconsult" },
        { label: "Lab sample at home (1,900+ tests)", href: "/lab-tests" },
        { label: "CareHub for Societies", href: "/carehub" },
      ],
      resources: [
        { label: "Book a visit", href: "/book" },
        { label: "Sanocare Pulse", href: "/sanopulse" },
        { label: "Patient Portal", href: "/portal" },
        { label: "About", href: "/about" },
        { label: "Insights", href: "/research" },
        { label: "Contact", href: "/contact" },
      ],
      legal: [
        { label: "Privacy Policy", href: "/privacy" },
        { label: "Terms of Service", href: "/terms" },
        { label: "Refund Policy", href: "/refund" },
        { label: "Emergency Disclaimer", href: "/emergency" },
        { label: "Grievance Officer", href: "/contact" },
      ],
    },
    socialLinks: [
      {
        icon: Instagram,
        href: "https://www.instagram.com/sanocare.in/",
        label: "Instagram — @sanocare.in",
      },
      {
        icon: Linkedin,
        href: "https://www.linkedin.com/company/sanocare-tech-innovations-private-limited/",
        label: "LinkedIn — Sanocare Tech Innovations",
      },
      {
        icon: Facebook,
        href: "https://www.facebook.com/profile.php?id=61587546362097",
        label: "Facebook — Sanocare",
      },
    ],
    contact: {
      addressLines: [
        "1666/B2, 3rd Floor, Gali 2,",
        "Govindpuri Extension, Kalkaji,",
        "New Delhi — 110019",
      ],
      mapsHref:
        "https://www.google.com/maps/search/?api=1&query=1666/B2,+Gali+2,+Govindpuri+Extension,+Kalkaji,+New+Delhi+110019",
      phone: "+91-9711977782",
      phoneHref: "tel:+919711977782",
      email: "contact@sanocare.in",
      emailHref: "mailto:contact@sanocare.in",
    },
    legalStrip: {
      emergencyDisclaimer:
        "Sanocare is not an emergency service. For chest pain, breathlessness, stroke symptoms or trauma, call 112 or 102 immediately.",
      legalEntity: "Sanocare Tech Innovations Private Limited",
      cin: "U86904DL2025PTC446725",
      registeredOffice:
        "1666/B2, 3rd Floor, Gali 2, Govindpuri Extension, Kalkaji, New Delhi — 110019",
      grievanceOfficer: "Shashwat Arora · contact@sanocare.in",
    },
    copyright:
      "© 2026 Sanocare Tech Innovations Pvt. Ltd. — CIN U86904DL2025PTC446725. All rights reserved.",
  },
};
