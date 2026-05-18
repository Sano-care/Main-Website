import {
  Calendar,
  CheckCircle,
  Globe,
  MessageCircle,
  Phone,
  Rocket,
  Send,
  Shield,
  Twitter,
  User,
  UserCheck,
} from "lucide-react";

export const SHARED_CONTENT = {
  topBannerAnnouncements: [
    {
      icon: Rocket,
      text: "Sanocare NOW is now live in Kalkaji & Govindpuri Extension!",
      highlight: "Sanocare NOW",
    },
    {
      icon: CheckCircle,
      text: "Launching permanent CareHubs in South Delhi Gated Societies soon.",
      highlight: "CareHubs",
    },
    {
      icon: Phone,
      text: "Emergency? Call +91-9571608318 for instant doorstep care.",
      highlight: "+91-9571608318",
    },
  ],
  navbar: {
    brandWordmarkPrefix: "Sano",
    brandWordmarkHighlight: "care",
    navLinks: [
      { href: "/services", label: "Services" },
      { href: "/research", label: "Insights" },
      { href: "/about", label: "About Us" },
      { href: "/contact", label: "Contact" },
    ],
    primaryCtaLabel: "Book Now",
    portalLabel: "Patient Portal",
    logoAlt: "Sanocare",
  },
  floatingSidebar: {
    buttons: [
      { icon: Calendar, label: "Book Now", href: "/#hero-booking-form" },
      { icon: Phone, label: "Call Us", href: "tel:+919571608318" },
      { icon: MessageCircle, label: "WhatsApp", href: "https://wa.me/919571608318" },
    ],
    portal: { icon: User, label: "Portal", href: "/portal" },
  },
  mobileStickyBar: {
    callLabel: "Call",
    callHref: "tel:+919571608318",
    bookLabel: "Book Consultation",
  },
  footer: {
    brandName: "Sanocare",
    brandWordmarkPrefix: "Sano",
    brandWordmarkHighlight: "care",
    logoAlt: "Sanocare",
    brandDescription:
      "Reimagining Primary Healthcare for Urban India. We bridge the gap between virtual and physical care with doctors, nurses, and diagnostics at your doorstep.",
    trustBadges: [
      { icon: UserCheck, label: "Highly Qualified Doctors" },
      { icon: Shield, label: "Secure" },
    ],
    links: {
      services: [
        { label: "Sanocare NOW", href: "/now" },
        { label: "CareHub for Societies", href: "/carehub" },
        { label: "All Services", href: "/services" },
        { label: "Teleconsultations", href: "/services#teleconsult" },
      ],
      resources: [
        { label: "Book a Visit", href: "/#hero-booking-form" },
        { label: "About Us", href: "/about" },
        { label: "Insights", href: "/research" },
        { label: "Contact", href: "/contact" },
      ],
      legal: [
        { label: "Privacy Policy", href: "/coming-soon/privacy" },
        { label: "Terms of Service", href: "/coming-soon/terms" },
        { label: "Sitemap", href: "/coming-soon/sitemap" },
      ],
    },
    socialLinks: [
      { icon: Twitter, href: "https://twitter.com/sanocare", label: "Twitter" },
      { icon: Globe, href: "https://sanocare.in", label: "Website" },
      { icon: Send, href: "https://t.me/sanocare", label: "Telegram" },
    ],
    contact: {
      addressLines: ["1666/2, Govindpuri Ext.", "Kalkaji, New Delhi, India"],
      mapsHref:
        "https://www.google.com/maps/search/?api=1&query=1666/2,+Govindpuri+Ext.,+Kalkaji,+New+Delhi",
      phone: "+91-9571608318",
      phoneHref: "tel:+919571608318",
      email: "contact@sanocare.in",
      emailHref: "mailto:contact@sanocare.in",
    },
    copyright: "© 2026 Sanocare. All rights reserved.",
  },
};
