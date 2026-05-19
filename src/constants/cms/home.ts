import {
  Activity,
  BadgeCheck,
  Building2,
  Clock,
  Heart,
  Home,
  IndianRupee,
  Shield,
  Smartphone,
  Stethoscope,
  UserCheck,
  Users,
  Video,
  Zap,
} from "lucide-react";

export const HOME_CONTENT = {
  hero: {
    badgeText: "Median time-to-medic: under 30 min",
    headingPrefix: "Trusted Healthcare at Home in",
    headingHighlight: "30 mins.",
    backgroundImageSrc:
      "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?q=80&w=2906&auto=format&fit=crop",
    description:
      "GNM / B.Sc Nursing-qualified medics arrive, capture vitals, and execute treatment — supervised in real time by a dedicated MBBS doctor on live video, who diagnoses the case and issues a signed e-prescription under MoHFW 2020. Starting from ₹499 per visit.",
    stats: [
      { value: "<30 min", label: "Median time-to-medic" },
      { value: "1,000+", label: "Home visits delivered" },
      { value: "★ 4.7", label: "75 Google reviews" },
    ],
    trust: {
      badgeLabel: "1k+",
      text: "MoHFW 2020 compliant",
    },
    bookingForm: {
      title: "Book a visit in 60 seconds",
      subtitle: "₹249 to confirm. Balance auto-charged on case close.",
      fields: {
        patientNameLabel: "Patient Name",
        patientNamePlaceholder: "Enter Full Name",
        phoneLabel: "Phone Number",
        phonePlaceholder: "+91 98765 43210",
        bookingForOtherLabel: "Booking for someone else",
        patientAddressLabel: "Patient Address",
        patientAddressPlaceholder: "House/Flat No, Building, Street, Locality",
        serviceTypeLabel: "Service Type",
      },
      geolocation: {
        addGpsLabel: "Add GPS",
        detectingLabel: "Detecting...",
        gpsAddedTemplate: "GPS added ({accuracy}) - helps paramedic navigate",
        gpsOptionalNote: "GPS optional but helps with faster arrival",
        bookingForOtherNote: "Enter the patient's complete address",
      },
      ctaLabel: "Book a Visit",
      submittingLabel: "Submitting...",
      secureNote: "Your information is 100% secure",
    },
    serviceOptions: [
      { value: "", label: "Select a service" },
      { value: "homecare", label: "Home visit — medic + doctor on video (from ₹499)" },
      { value: "nursing", label: "Nursing-only — injection, IV, dressing (from ₹199)" },
      { value: "teleconsult", label: "Teleconsultation — MBBS doctor on video (from ₹399)" },
      { value: "diagnostics", label: "Lab sample at home — free collection, pay per test" },
    ],
  },
  bookingModal: {
    headerTitle: "Book a Home Visit",
    leftPanel: {
      title: "A medic at your door in 30 minutes.",
      subtitle: "GNM / B.Sc Nursing-qualified medic + MBBS doctor on live video, signed e-prescription under MoHFW 2020.",
      nextStepsTitle: "What Happens Next?",
      nextSteps: [
        "Your care coordinator calls to confirm details within minutes",
        "A qualified medic is dispatched to your address",
        "An MBBS doctor joins live, diagnoses, and issues a signed e-prescription",
      ],
      stats: [
        { value: "<30", label: "Min to medic" },
        { value: "1,000+", label: "Visits delivered" },
        { value: "★ 4.7", label: "75 Google reviews" },
      ],
    },
    form: {
      fields: {
        patientNameLabel: "Patient Name",
        patientNamePlaceholder: "Enter Full Name",
        phoneLabel: "Phone Number",
        phonePlaceholder: "+91 98765 43210",
        bookingForOtherLabel: "Booking for someone else",
        patientAddressLabel: "Patient Address",
        patientAddressPlaceholder: "House/Flat No, Building, Street, Locality",
        serviceTypeLabel: "Service Type",
      },
      geolocation: {
        addGpsLabel: "Add GPS",
        detectingLabel: "Detecting...",
        gpsAddedTemplate: "GPS added ({accuracy}) - helps paramedic navigate",
        gpsOptionalNote: "GPS optional but helps with faster arrival",
        bookingForOtherNote: "Enter the patient's complete address",
      },
      promoLabel: "First Consultation FREE",
      ctaLabel: "Book Appointment",
      submittingLabel: "Submitting...",
      responseTimeNote: "Average response time: 30 minutes",
    },
    // Must use the same `value` strings as hero.serviceOptions so the
    // serviceCategory check in useBookingSubmit (=== "diagnostics") matches
    // and the lab-tests redirect intercept fires consistently from both forms.
    serviceOptions: [
      { value: "", label: "Select a service" },
      { value: "homecare", label: "Home visit — medic + doctor on video (from ₹499)" },
      { value: "nursing", label: "Nursing-only — injection, IV, dressing (from ₹199)" },
      { value: "teleconsult", label: "Teleconsultation — MBBS doctor on video (from ₹399)" },
      { value: "diagnostics", label: "Lab sample at home — free collection, pay per test" },
    ],
  },
  features: {
    sectionCopy: {
      badge: "Our Services",
      title: "What You Get",
      aboutLinkLabel: "Learn more about us",
      aboutLinkHref: "/about",
    },
    services: [
      {
        icon: Home,
        title: "Home visit",
        description:
          "A GNM / B.Sc Nursing-qualified medic arrives with vitals kit; an MBBS doctor joins on live video to diagnose and issue a signed e-prescription under MoHFW 2020.",
        features: ["Medic on-site", "MBBS doctor on video", "Signed e-prescription", "15-min consult"],
        price: "From ₹499 / visit",
      },
      {
        icon: Stethoscope,
        title: "Nursing-only visit",
        description:
          "Trained medic for a single procedure — injection, IV drip, wound dressing, or home sample collection. No doctor consultation included.",
        features: ["Injections", "IV / drips", "Wound dressing", "Sample collection"],
        price: "From ₹199 / visit",
      },
      {
        icon: Video,
        title: "Teleconsultation",
        description:
          "Direct video consultation with an MBBS doctor. Get a signed digital prescription without anyone visiting your home.",
        features: ["MBBS doctor on video", "15-min consult", "Digital Rx", "Follow-up support"],
        price: "From ₹399 / 15 min",
      },
      {
        icon: Activity,
        title: "Lab sample at home",
        description:
          "Free home collection by a trained phlebotomist. Choose from 1,900+ tests via our partner Pathcore Diagnostics. Pay only the test cost when your report is ready.",
        features: ["Free home collection", "1,900+ tests", "Pay-after-report", "Signed PDF report"],
        price: "Free collection · pay per test",
      },
    ],
  },
  statsBar: {
    stats: [
      { value: "<30", suffix: "min", label: "Median time-to-medic", subtext: "From booking to medic at your door" },
      { value: "1,000", suffix: "+", label: "Home visits delivered", subtext: "Across Kalkaji & Govindpuri Ext." },
      { value: "4.7", suffix: "★", label: "From 75 Google reviews", subtext: "Sanocare – Home Healthcare Services" },
    ],
  },
  journey: {
    header: {
      badge: "How It Works",
      title: "Your Care Journey",
      description:
        "From booking to recovery, healthcare has never been this convenient. We bring the clinic to you.",
    },
    steps: [
      {
        number: 1,
        title: "Book your visit",
        description:
          "Pick a service and time. ₹249 confirms the booking; the balance auto-charges on case close. Full refund before the medic is dispatched.",
        image:
          "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?q=80&w=800&auto=format&fit=crop",
      },
      {
        number: 2,
        title: "Medic arrives + MBBS doctor on live video",
        description:
          "A GNM / B.Sc Nursing-qualified medic reaches you in under 30 minutes, captures vitals, and your assigned MBBS doctor joins on live video to diagnose.",
        image:
          "https://images.unsplash.com/photo-1579684385127-1ef15d508118?q=80&w=800&auto=format&fit=crop",
      },
      {
        number: 3,
        title: "Signed e-prescription + follow-up",
        description:
          "The doctor issues a signed digital prescription under MoHFW Telemedicine Practice Guidelines 2020. Follow-up support included until your case closes.",
        image:
          "https://images.unsplash.com/photo-1631815588090-d4bfec5b1b89?q=80&w=800&auto=format&fit=crop",
      },
    ],
  },
  // Empty until we collect real, attributable testimonials. The Testimonials
  // component returns null when this is empty so the section is hidden.
  testimonials: [] as Array<{
    quote: string;
    name: string;
    treatment: string;
    initial: string;
  }>,
  testimonialsHeader: {
    badge: "Real Stories",
    title: "Patient Testimonials",
  },
  insights: {
    sectionTitle: "Medical Insights",
    // Empty until we publish first-party clinical articles. The Insights
    // component renders the section header but no cards when this is empty.
    articles: [] as Array<{
      slug: string;
      category: string;
      readTime: string;
      title: string;
      description: string;
      image: string;
    }>,
  },
  trust: {
    sectionTitle: "Built on real medical practice — not chatbots.",
    badges: [
      {
        icon: UserCheck,
        name: "Verified medics",
        description: "100% background-checked GNM / B.Sc Nursing",
      },
      {
        icon: Stethoscope,
        name: "MBBS-supervised",
        description: "Every visit reviewed live by a registered MBBS doctor",
      },
      {
        icon: BadgeCheck,
        name: "MoHFW 2020 compliant",
        description: "Telemedicine Practice Guidelines followed end-to-end",
      },
      {
        icon: Shield,
        name: "DPDP 2023 compliant",
        description: "Patient data secured under Indian law",
      },
      {
        icon: Clock,
        name: "Under 30 min response",
        description: "Median time-to-medic across our service area",
      },
    ],
    metrics: [
      "1,000+ home visits delivered",
      "★ 4.7 from 75 verified Google reviews",
      "Serving Kalkaji & Govindpuri Extension",
    ],
  },
};

export const SANOCARE_ADVANTAGE_CONTENT = {
  pageCopy: {
    badge: "Why Choose Us",
    titlePrefix: "The Sanocare",
    titleHighlight: "Advantage",
    description:
      "See how Sanocare NOW compares to traditional healthcare options. We combine the best of both worlds-physical care with digital convenience.",
    featureLabel: "Feature",
    serviceModelsTitle: "Our Service Models",
    exploreAllLabel: "Explore all our services",
  },
  comparisonData: {
    providers: [
      {
        name: "Traditional Hospitals",
        icon: Building2,
        description: "In-person visits with travel and wait times",
        highlight: false,
      },
      {
        name: "Telemedicine Apps",
        icon: Smartphone,
        description: "Virtual consultations only",
        highlight: false,
      },
      {
        name: "Sanocare NOW",
        icon: Zap,
        description: "Doorstep care within 30 minutes",
        highlight: true,
      },
    ],
    features: [
      {
        name: "Response Time",
        icon: Clock,
        traditional: "2-4 Hours (Travel+Wait)",
        telemedicine: "15 Mins (Consult only)",
        sanocare: "30 Mins (At your door)",
      },
      {
        name: "Physical Care",
        icon: Home,
        traditional: "Yes (But requires travel)",
        telemedicine: "No (Consult only)",
        sanocare: "Yes (Medics at home)",
      },
      {
        name: "Risk Detection",
        icon: Shield,
        traditional: "Reactive",
        telemedicine: "Basic",
        sanocare: "Proactive & Structured",
      },
      {
        name: "Pricing",
        icon: IndianRupee,
        traditional: "High (Travel + Fees)",
        telemedicine: "Variable",
        sanocare: "Transparent & Fixed",
      },
    ],
  },
  serviceOfferings: [
    {
      id: "sanocare-now",
      name: "Sanocare NOW",
      tagline: "Direct to Consumer Healthcare",
      icon: Zap,
      color: "primary",
      description:
        "Get doctors, nurses, and diagnostics at your doorstep within 30 minutes. Pay-per-visit model starting at ₹499.",
      features: [
        { icon: Clock, text: "30 min response" },
        { icon: Stethoscope, text: "Trained paramedics" },
        { icon: Home, text: "Homecare & nursing" },
        { icon: Activity, text: "Diagnostics at home" },
      ],
      cta: "Book a Visit",
      ctaLink: "/#hero-booking-form",
      learnMore: "/now",
    },
    {
      id: "carehub",
      name: "CareHub",
      tagline: "For Gated Communities",
      icon: Building2,
      color: "coral",
      description:
        "Transform your society into a health-first community with dedicated healthcare infrastructure and priority response.",
      features: [
        { icon: Users, text: "Dedicated care team" },
        { icon: Shield, text: "<15 min response" },
        { icon: Heart, text: "Health camps" },
        { icon: Activity, text: "Resident tracking" },
      ],
      cta: "Request for Society",
      ctaLink: "/carehub",
      learnMore: "/carehub",
    },
  ],
  valuePropositions: [
    {
      title: "Speed over appointments",
      description:
        "A trained medic is at your door in under 30 minutes — faster than scheduling a clinic visit, faster than reaching the nearest hospital OPD.",
      icon: Clock,
    },
    {
      title: "Hands-on care, not just video",
      description:
        "Physical exam, vitals capture, and treatment executed in your home — supervised in real time by a dedicated MBBS doctor on live video.",
      icon: Stethoscope,
    },
    {
      title: "Honest escalation",
      description:
        "Every case is risk-classified Green / Yellow / Red. If your case needs a hospital, we say so — clearly, in writing, before we leave.",
      icon: Shield,
    },
    {
      title: "Transparent pricing",
      description:
        "Starting-from prices on every SKU. ₹249 captured at booking, balance auto-charged on case close. No hidden fees. GST-exempt clinical healthcare.",
      icon: IndianRupee,
    },
  ],
};
