export const BLOG_PAGE_CONTENT = {
  template: {
    breadcrumbHomeLabel: "Insights",
    featuredLabel: "Featured Article",
    publishedPrefix: "Published",
    shareButtonLabel: "Share",
    keyTakeawayTitle: "Key Takeaway",
    keyTakeawaySubtitle: "From this article",
    keyTakeawayText:
      "Healthcare is evolving rapidly with technology and patient-centered approaches leading the way.",
    cta: {
      title: "Need Expert Healthcare at Home?",
      description:
        "Our verified healthcare professionals can visit your home for consultations, nursing care, and lab tests.",
      ctaLabel: "Book a Home Visit",
      ctaHref: "/",
    },
    authorSection: {
      title: "About the Author",
      description:
        "Expert healthcare professional dedicated to improving patient outcomes through evidence-based practices.",
      viewProfileLabel: "View Profile",
    },
    relatedArticlesLabel: "Related Articles",
    newsletter: {
      title: "Health Insights Weekly",
      description: "Get the latest health tips and medical insights delivered to your inbox every week.",
      emailPlaceholder: "your@email.com",
      ctaLabel: "Subscribe to Insights",
      privacyNote: "We respect your privacy. Unsubscribe anytime.",
    },
    backLabel: "Back to All Articles",
  },
};

export const NOT_FOUND_PAGE_CONTENT = {
  logoAlt: "Sanocare",
  brandWordmarkPrefix: "Sano",
  brandWordmarkHighlight: "care",
  pageCode: "404",
  title: "Page Not Found",
  description:
    "Looks like this page took a sick day! Don't worry, our care team is always available. Let's get you back on track.",
  actions: {
    primaryLabel: "Go Home",
    primaryHref: "/",
    secondaryLabel: "Browse Services",
    secondaryHref: "/#services",
  },
  quickLinksLabel: "Quick links:",
  quickLinks: [
    { label: "Services", href: "/#services" },
    { label: "Specialists", href: "/#specialists" },
    { label: "Contact", href: "/#contact" },
    { label: "Sign in", href: "/portal" },
  ],
  helpLabel: "Need help? Call us at",
  helpPhone: "+91-9711977782",
  helpPhoneHref: "tel:+919711977782",
};

export const COMING_SOON_PAGE_CONTENT = {
  logoAlt: "Sanocare",
  brandWordmarkPrefix: "Sano",
  brandWordmarkHighlight: "care",
  backToHomeLabel: "Back to Home",
  defaultEntry: {
    title: "Coming Soon",
    description: "We're working hard to bring you this feature. Check back soon!",
    eta: "Soon",
  },
  headingSuffix: "Under Construction",
  expectedPrefix: "Expected:",
  goBackHomeLabel: "Go Back Home",
  notifyLabel: "Notify Me",
  notifyToast: "Thanks! We'll notify you when this page is ready.",
  contactHelpLabel: "Need immediate help? Call us at",
  contactPhone: "+91-9711977782",
  contactPhoneHref: "tel:+919711977782",
  entries: {
    about: {
      title: "About Us",
      description: "Learn more about Sanocare's mission, vision, and the team behind reimagining primary healthcare.",
      eta: "Q2 2026",
    },
    privacy: {
      title: "Privacy Policy",
      description: "Our commitment to protecting your health data and personal information.",
      eta: "Q1 2026",
    },
    terms: {
      title: "Terms of Service",
      description: "Terms and conditions for using Sanocare services.",
      eta: "Q1 2026",
    },
    sitemap: {
      title: "Sitemap",
      description: "A comprehensive map of all pages and resources on our website.",
      eta: "Q1 2026",
    },
    blog: {
      title: "Health Blog",
      description: "Medical insights, health tips, and wellness articles from our expert doctors.",
      eta: "Q2 2026",
    },
    careers: {
      title: "Careers",
      description: "Join our mission to make quality healthcare accessible to every household.",
      eta: "Q2 2026",
    },
    chat: {
      title: "Live Chat Support",
      description: "Get instant help from our care coordinators via chat.",
      eta: "Q2 2026",
    },
  },
};

export const PORTAL_PAGE_CONTENT = {
  logoAlt: "Sanocare",
  // Single-word minimalist wordmark (matches the rest of the site).
  brandWordmarkPrefix: "Sanocare",
  brandWordmarkHighlight: "",
  backToHomeLabel: "Back to Home",
  badgeLabel: "Coming with Sanocare Pulse",
  titlePrefix: "Your patient portal is being",
  titleHighlight: "built into Sanocare Pulse.",
  description:
    "Every visit, every prescription, every vitals reading — accessible from your phone or any browser. We're building the patient web portal as part of Sanocare Pulse Phase 1, our patient mobile application. Join the Pulse beta waitlist to be among the first to use it.",
  featureTitle: "What you'll see in your portal:",
  features: [
    "View & download medical records — every visit, every prescription, searchable and downloadable.",
    "Track upcoming appointments — live status from booking through case close.",
    "Access diagnostic reports & vitals trends — every lab report, every BP / SpO₂ / glucose reading captured during a visit, plotted over time.",
    "Manage prescriptions & refills — request a refill of any active prescription with one tap.",
    "Securely share records with any doctor — generate a time-bound, read-only link for second opinions.",
  ],
  primaryCta: {
    label: "Join the Pulse beta waitlist",
    href: "/sanopulse",
  },
  secondaryCta: {
    label: "Book a visit now",
    href: "/",
  },
  helpStrip: {
    label: "Already a patient and need your records right now?",
    phoneLabel: "Call us at +91-97119 77782",
    phoneHref: "tel:+919711977782",
    emailLabel: "Email contact@sanocare.in",
    emailHref: "mailto:contact@sanocare.in",
    note: "Our care team can WhatsApp your records the same day under your DPDP 2023 consent.",
  },
};
