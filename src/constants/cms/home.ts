import {
  Activity,
  BadgeCheck,
  Building2,
  Clock,
  Heart,
  HeartPulse,
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
    badgeText: "Now Serving Delhi NCR",
    headingPrefix: "Healthcare at",
    headingHighlight: "your Doorstep.",
    backgroundImageSrc:
      "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?q=80&w=2906&auto=format&fit=crop",
    description:
      "We bridge the gap between virtual and physical care. Get doctors, nurses, and diagnostics right at your home or within your gated society.",
    stats: [
      { value: "30 Mins", label: "Response Time" },
      { value: "MBBS", label: "Qualified Doctors" },
      { value: "₹499", label: "Starting Price" },
    ],
    trust: {
      badgeLabel: "+2k",
      text: "Trusted by families",
    },
    bookingForm: {
      title: "Book Consultation",
      subtitle: "First consultation is free*",
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
      { value: "", label: "Select Service" },
      { value: "homecare", label: "Homecare (Doctor Visit, Nursing, Vitals)" },
      { value: "teleconsult", label: "Teleconsultation (Video Consult)" },
      { value: "chronic", label: "Chronic Disease Management" },
      { value: "diagnostics", label: "Early Risk Diagnostics" },
    ],
  },
  bookingModal: {
    headerTitle: "Book a Home Visit",
    leftPanel: {
      title: "Healthcare at Your Doorstep",
      subtitle: "Doctors, nurses & diagnostics - right at your home",
      nextStepsTitle: "What Happens Next?",
      nextSteps: [
        "Our care coordinator calls you within 30 minutes",
        "We understand your needs and assign the right doctor",
        "Doctor arrives at your preferred time slot",
      ],
      stats: [
        { value: "30", label: "Min Response" },
        { value: "100%", label: "Verified" },
        { value: "24/7", label: "Support" },
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
    serviceOptions: [
      { value: "", label: "Select Service" },
      { value: "home-visit", label: "Doctor Home Visit" },
      { value: "teleconsult", label: "Teleconsultation" },
      { value: "nursing", label: "Nursing & Paramedic" },
      { value: "lab", label: "Lab Sample Collection" },
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
        title: "Homecare",
        description:
          "Medic-led doorstep execution for acute needs. Professional healthcare delivered to your home within 30 minutes.",
        features: ["Vitals Capture", "Injections", "Wound Dressing", "Sample Collection"],
        price: "₹499/15min",
      },
      {
        icon: Video,
        title: "Teleconsultation",
        description:
          "24/7 virtual access to dedicated MBBS doctors. Get expert medical advice without leaving your home.",
        features: ["Video Consult", "Digital Rx", "Follow-up Guidance"],
        price: "₹199/session",
      },
      {
        icon: HeartPulse,
        title: "Chronic Disease Management",
        description:
          "Specialized monitoring for elderly and long-term health conditions with dedicated care protocols.",
        features: ["Diabetes Support", "Hypertension Monitoring", "Family Health Tracking"],
        price: "Custom Plans",
      },
      {
        icon: Activity,
        title: "Early Risk Diagnostics",
        description:
          "Automated screening to detect health risks before they escalate. Prevention is better than cure.",
        features: ["Quick Risk Diagnosis", "Preventive Screening", "AI Health Insights"],
        price: "Starting ₹299",
      },
    ],
  },
  statsBar: {
    stats: [
      { value: "30", suffix: "min", label: "Average Response Time", subtext: "Quick care when you need it" },
      { value: "100", suffix: "%", label: "Highly Qualified Doctors", subtext: "MBBS & specialist qualified" },
      { value: "24", suffix: "/7", label: "Support Available", subtext: "Healthcare never stops" },
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
        title: "Book Your Visit",
        description:
          "Share your details and preferred time slot. Our care coordinator contacts you within 30 minutes to understand your needs.",
        image:
          "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?q=80&w=800&auto=format&fit=crop",
      },
      {
        number: 2,
        title: "Doctor at Your Doorstep",
        description:
          "A verified paramedic arrives at your home with necessary equipment for consultation, vitals check, and initial diagnosis.",
        image:
          "https://images.unsplash.com/photo-1579684385127-1ef15d508118?q=80&w=800&auto=format&fit=crop",
      },
      {
        number: 3,
        title: "Complete Care & Follow-up",
        description:
          "Receive digital prescription, lab sample collection at home if needed, and ongoing support for your recovery journey.",
        image:
          "https://images.unsplash.com/photo-1631815588090-d4bfec5b1b89?q=80&w=800&auto=format&fit=crop",
      },
    ],
  },
  testimonials: [
    {
      quote:
        "Getting a doctor at home within an hour was a lifesaver for my elderly mother. The doctor was professional and took time to explain everything.",
      name: "Sanyam Modi",
      treatment: "Home Doctor Visit",
      initial: "P",
    },
    {
      quote:
        "The teleconsultation was so convenient. I got my prescription digitally and even had medicines delivered. No more waiting in long queues!",
      name: "Abhishek Bisht",
      treatment: "Teleconsultation",
      initial: "P",
    },
    {
      quote:
        "Lab sample collection at home saved my entire day. The paramedic was punctual and the reports came quickly. Highly recommend Sanocare!",
      name: "Aamir Sohai",
      treatment: "Lab Collection at Home",
      initial: "P",
    },
  ],
  testimonialsHeader: {
    badge: "Real Stories",
    title: "Patient Testimonials",
  },
  insights: {
    sectionTitle: "Medical Insights",
    articles: [
      {
        slug: "managing-seasonal-allergies",
        category: "Wellness",
        readTime: "5 min read",
        title: "Managing Seasonal Allergies Effectively",
        description:
          "Learn how to handle the changing seasons effectively with our comprehensive guide.",
        image:
          "https://images.unsplash.com/photo-1490750967868-88aa4486c946?q=80&w=800&auto=format&fit=crop",
      },
      {
        slug: "future-of-telehealth",
        category: "Technology",
        readTime: "3 min read",
        title: "The Future of Telehealth and Virtual Care",
        description:
          "Virtual care is changing the landscape of medicine, making it easier than ever to see a specialist.",
        image:
          "https://images.unsplash.com/photo-1576091160550-2173dba999ef?q=80&w=800&auto=format&fit=crop",
      },
      {
        slug: "heart-health-basics",
        category: "Cardiology",
        readTime: "7 min read",
        title: "Heart Health Basics for Longevity",
        description:
          "Simple steps for a healthier, longer life. Understand the vital signs.",
        image:
          "https://images.unsplash.com/photo-1628348068343-c6a848d2b6dd?q=80&w=800&auto=format&fit=crop",
      },
    ],
  },
  trust: {
    sectionTitle: "Why Thousands Trust Sanocare",
    badges: [
      {
        icon: UserCheck,
        name: "Verified Healthcare Staff",
        description: "100% Background Checked",
      },
      {
        icon: Shield,
        name: "DISHA Compliant",
        description: "Data Security Certified",
      },
      {
        icon: Clock,
        name: "24/7 Support",
        description: "Always Available",
      },
      {
        icon: BadgeCheck,
        name: "Licensed & Insured",
        description: "Fully Accredited",
      },
      {
        icon: Stethoscope,
        name: "Quality Assured",
        description: "ISO 9001 Standards",
      },
    ],
    metrics: [
      "5000+ Consultations Completed",
      "4.9★ Average Rating",
      "Serving Delhi NCR Since 2024",
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
      color: "indigo",
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
    { title: "Speed over appointments", desc: "No waiting, instant dispatch" },
    { title: "Dedicated doctors", desc: "MBBS professionals, not ad-hoc" },
    { title: "Medic-led execution", desc: "ANMs/DNMs at your doorstep" },
    { title: "Intelligence over friction", desc: "Tech that resolves, not just books" },
  ],
};
