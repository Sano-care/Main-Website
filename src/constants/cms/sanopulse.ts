import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Calendar,
  FileText,
  MapPin,
  MessageSquare,
  Shield,
  Smartphone,
  UserPlus,
  Users,
  Video,
} from "lucide-react";

export interface SanopulseFeature {
  icon: LucideIcon;
  title: string;
  description: string;
}

export interface SanopulseRoadmapPhase {
  phase: string;
  status: "in_development" | "planned" | "roadmap";
  statusLabel: string;
  items: string[];
}

export interface SanopulseFaq {
  question: string;
  answer: string;
}

export const SANOPULSE_PAGE_CONTENT = {
  meta: {
    title: "Sanocare Pulse — Your Care in Your Pocket",
    description:
      "Sanocare Pulse is the Android patient app that powers Sanocare. Book visits, track your medic, join your doctor on video, manage your family's health. Currently in closed beta — request your cohort invite.",
  },
  hero: {
    eyebrowText: "Closed beta · Android · Cohort rollout in progress",
    titlePrefix: "Sanocare Pulse —",
    titleHighlight: "your care, in your pocket.",
    description:
      "The Sanocare Pulse Android application is the digital backbone of every Sanocare visit. Book consultations, watch your medic arrive in real time, join your dedicated doctor on video, view every prescription you've ever been issued, and manage your family's health — all from one screen. We're inviting families into the beta in small cohorts.",
    primaryCtaLabel: "Request beta access",
    primaryCtaHref: "#waitlist",
    secondaryCtaLabel: "See what's coming",
    secondaryCtaHref: "#features",
    trustBullets: [
      "Cohort 1 invites going out",
      "MoHFW Telemedicine 2020 compliant",
      "Built for South Delhi, expanding",
      "DPDP 2023 compliant by design",
    ],
  },
  features: {
    badge: "What's in Pulse",
    title: "Everything you'd want from your primary-care app.",
    description:
      "Pulse doesn't replace your medic or your doctor — it makes booking, tracking, and remembering them effortless.",
    items: [
      {
        icon: Calendar,
        title: "Book a visit in 60 seconds",
        description:
          "Pick a service, confirm your address with GPS, and pay 50% to confirm. The remaining balance is auto-charged when the doctor closes your case.",
      },
      {
        icon: MapPin,
        title: "Track your medic in real time",
        description:
          "Name, photo, council registration, live ETA — like a ride-share, for healthcare. Know exactly when to expect them at your door.",
      },
      {
        icon: Video,
        title: "Doctor on live video, in-app",
        description:
          "Your dedicated MBBS doctor joins on a video call the moment vitals are captured. No external app, no app-switching, no link to click.",
      },
      {
        icon: FileText,
        title: "Signed e-prescription on the spot",
        description:
          "Issued under MoHFW Telemedicine Practice Guidelines 2020. Downloadable as PDF, accessible forever from your records.",
      },
      {
        icon: Users,
        title: "Family profiles",
        description:
          "Manage up to 5 family members from one phone. Mum, dad, kids, in-laws — switch profiles in a tap, book on their behalf with their consent.",
      },
      {
        icon: Activity,
        title: "All your records, in one place",
        description:
          "Visit history, prescriptions, vitals trends, lab reports. Searchable. Exportable. Yours.",
      },
    ] satisfies SanopulseFeature[],
  },
  fitsInto: {
    title: "How Pulse fits into your care.",
    description:
      "Pulse is the patient layer of the same platform Sanocare's doctors and medics use to deliver care. Every booking, every visit, every prescription, every vitals reading flows into your Pulse record automatically. Six months from now you'll be able to show your specialist a clean, chronological view of your health — without rummaging through WhatsApp.",
  },
  roadmap: {
    badge: "Roadmap",
    title: "Three phases. We publish when we ship.",
    description:
      "We won't promise dates we can't hit. Status updates go out to every patient on the cohort waitlist.",
    phases: [
      {
        phase: "Phase 1",
        status: "in_development",
        statusLabel: "In development · Cohort rollout",
        items: [
          "Android app · Booking & live tracking",
          "In-app video consultation",
          "Digital prescriptions",
          "Family profiles · Health records",
          "Provider dashboards for doctors & medics",
        ],
      },
      {
        phase: "Phase 2",
        status: "planned",
        statusLabel: "Planned",
        items: [
          "iOS app",
          "Automated cancellation & refund flow",
          "Medicine delivery",
          "Lab sample tracking",
          "Native Provider apps",
          "Multi-generation family timeline",
        ],
      },
      {
        phase: "Phase 3",
        status: "roadmap",
        statusLabel: "Roadmap",
        items: [
          "Chronic care plans",
          "AI risk detection from vitals + symptoms",
          "CareHub-resident tab",
          "Insurance integrations",
        ],
      },
    ] satisfies SanopulseRoadmapPhase[],
  },
  waitlist: {
    badge: "Request beta access",
    title: "Tell us a bit about you.",
    description:
      "We open cohorts of ~50 patients at a time, prioritising pincodes where Sanocare NOW already operates. Typical wait: 3–4 weeks between cohorts. We'll email and SMS you the moment your area is in the next cohort.",
    fields: {
      nameLabel: "Full name",
      namePlaceholder: "Your full name",
      phoneLabel: "Mobile number",
      phonePlaceholder: "+91 98765 43210",
      emailLabel: "Email",
      emailPlaceholder: "you@example.com",
      pincodeLabel: "Pincode",
      pincodePlaceholder: "e.g. 110019",
      reasonLabel: "Why are you interested? (optional)",
      reasonPlaceholder:
        "Tell us a bit about who Pulse is for — yourself, an ageing parent, kids, etc.",
      consentLabel:
        "I agree to be contacted by Sanocare about the Pulse beta. I understand I can withdraw consent any time by emailing contact@sanocare.in. (Required for DPDP 2023.)",
    },
    submitLabel: "Add me to the cohort waitlist",
    submittingLabel: "Adding you to the waitlist…",
    successMessage:
      "You're on the waitlist. We'll email and SMS you the moment a cohort opens up in your area. No spam, ever.",
    errorMessage:
      "Couldn't submit — please try again or email contact@sanocare.in.",
    spamFieldName: "bot-field",
  },
  faq: {
    badge: "Pulse FAQ",
    title: "Questions before you sign up.",
    items: [
      {
        question: "When will Pulse be available to me?",
        answer:
          "We're rolling out in cohorts of about 50 patients at a time, prioritising pincodes where Sanocare NOW already operates. If you're in Kalkaji or Govindpuri Extension, you're likely in an early cohort. Pincodes outside our current service area join the waitlist; we'll invite you when we expand.",
      },
      {
        question: "Is Pulse free?",
        answer:
          "Yes — the app is free. You pay only for the Sanocare services you book through it (₹499 for a home visit, ₹199 for a nursing-only visit, etc.) — the same prices as our website.",
      },
      {
        question: "What does “Closed Beta” mean?",
        answer:
          "We're not yet open to public download. We hand-select small groups of patients, observe how the app performs in real conditions, and fix things before opening to everyone. Beta participants get the product at a polish-in-progress stage, in exchange for a direct line to our team.",
      },
      {
        question: "Do I need to use Pulse to book a visit?",
        answer:
          "No. You can always book through sanocare.in or call +91 97119 77782. Pulse is an option, not a requirement.",
      },
      {
        question: "What about iPhone?",
        answer:
          "The iOS app is Phase 2 — we'll announce when the iOS beta opens. Until then, iPhone users can use sanocare.in to book, and the web Patient Portal (also in development) works in any browser.",
      },
      {
        question: "Will Pulse work where I live?",
        answer:
          "Pulse runs on any Android phone with internet. Booking a Sanocare visit through Pulse only works in pincodes where Sanocare NOW is operational — currently Kalkaji and Govindpuri Extension, expanding into Greater Kailash, Saket, and CR Park next.",
      },
    ] satisfies SanopulseFaq[],
  },
  privacy: {
    badge: "Your health data, your control",
    title: "Pulse is built for the DPDP Act 2023.",
    items: [
      {
        icon: Shield,
        title: "Encrypted at rest and in transit",
        description:
          "TLS 1.2+ everywhere. Records encrypted in our Supabase database with row-level security.",
      },
      {
        icon: UserPlus,
        title: "Consent, not assumption",
        description:
          "Every consultation and data-use action requires your explicit, withdrawable consent — captured upfront, logged in Pulse.",
      },
      {
        icon: MessageSquare,
        title: "Not for sale",
        description:
          "We don't sell your data. We don't train AI models on your records without your explicit consent. Withdraw any time by emailing contact@sanocare.in.",
      },
      {
        icon: Smartphone,
        title: "Yours to export",
        description:
          "Right-to-portability is built in. Request your full record any time and receive it within 30 days as required by law.",
      },
    ],
    grievanceLine:
      "Grievance officer: Shashwat Arora · contact@sanocare.in · 1666/B2, 3rd Floor, Gali 2, Govindpuri Extension, Kalkaji, New Delhi — 110019.",
  },
  ctaBand: {
    title: "Bring Sanocare home — through the app.",
    description:
      "The Pulse cohort is the easiest way to use Sanocare NOW today, and the only way once we deprecate WhatsApp bookings. Add yourself to the waitlist and we'll do the rest.",
    primaryCtaLabel: "Request beta access",
    primaryCtaHref: "#waitlist",
    secondaryCtaLabel: "Browse services",
    secondaryCtaHref: "/services",
  },
};
