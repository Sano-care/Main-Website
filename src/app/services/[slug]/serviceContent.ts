// SEO service-landing content map. One entry per dedicated, keyword-targeted
// service page under /services/<seoSlug>. Content is lifted + expanded from
// the canonical catalog (src/lib/services/catalog.ts) and founder-approved
// copy; every page carries 300+ words of unique body text, 5 FAQs, and the
// data needed for Service / BreadcrumbList / FAQPage schema.
//
// `serviceSlug` ties each SEO page back to the canonical ServiceSlug so the
// CTA preselects the right service and labels stay locked to the shipped
// getServiceLabel() helper.

import type { ServiceSlug } from "@/lib/services/catalog";

export interface ServiceFaq {
  q: string;
  a: string;
}

export interface IncludedBlock {
  heading: string;
  body: string;
}

export interface HowItWorksStep {
  title: string;
  body: string;
}

export interface ServicePageContent {
  /** URL slug under /services/. */
  seoSlug: string;
  /** Canonical catalog slug — drives the CTA + getServiceLabel(). */
  serviceSlug: ServiceSlug;

  // ----- meta (title <=60 chars, description <=160) -----
  metaTitle: string;
  metaDescription: string;

  // ----- hero -----
  h1: string;
  subtitle: string; // includes a pricing anchor

  // ----- Service schema -----
  schemaServiceName: string;
  serviceType: string;
  /** Lead price as a string for Offer.price; "200" = lab collection fee. */
  price: string;
  breadcrumbName: string;

  // ----- body -----
  intro: string;
  included: IncludedBlock[];
  useCases: string[];
  howItWorks: HowItWorksStep[];
  pricingNote: string;
  faqs: ServiceFaq[];
  /**
   * When true, the page renders the Google-Ads classifier-safe footer
   * variant (nursing-only bio, no telemedicine service links) and omits the
   * "Our other services" cross-link grid — so the URL can be a paid-ads
   * landing destination without tripping the healthcare-services classifier.
   */
  classifierSafe?: boolean;
}

const AREA = "Kalkaji, Govindpuri Extension and the wider South Delhi NCR";

const HOW_IT_WORKS_INPERSON: HowItWorksStep[] = [
  {
    title: "Book in 60 seconds",
    body: "Tell us the patient, the area and what's needed. Pay 50% to confirm; the balance is settled when the case closes.",
  },
  {
    title: "Medic dispatched",
    body: "A trained GNM / B.Sc Nursing medic nearest you is assigned and heads to your door — median time-to-medic is under 30 minutes in Delhi NCR.",
  },
  {
    title: "In-home visit + virtual doctor",
    body: "The medic records vitals and assists the examination while your MBBS doctor joins on live video to diagnose.",
  },
  {
    title: "Signed e-prescription",
    body: "The doctor issues a signed digital prescription under MoHFW Telemedicine 2020. Every record is saved to your Sanocare Pulse account.",
  },
];

export const SERVICE_PAGES: Record<string, ServicePageContent> = {
  "doctor-home-visit-delhi": {
    seoSlug: "doctor-home-visit-delhi",
    serviceSlug: "home-visit",
    metaTitle: "Doctor Home Visit in Delhi — Sanocare | ₹499, <30 min",
    metaDescription:
      "Trained medic at your door in under 30 minutes; an MBBS doctor consults virtually and issues a signed e-prescription under MoHFW 2020. Serving Kalkaji, Govindpuri Extension & South Delhi. From ₹499.",
    h1: "Doctor Home Visit in Delhi",
    subtitle:
      "Starting from ₹499 · a medic at your door in under 30 minutes, with an MBBS doctor live on video.",
    schemaServiceName: "Doctor Home Visit in Delhi",
    serviceType: "Home doctor consultation",
    price: "499",
    breadcrumbName: "Doctor Home Visit Delhi",
    intro:
      "When someone at home is unwell, getting to a clinic isn't always possible — especially for elderly parents, young children, or anyone recovering after a hospital stay. A Sanocare doctor home visit brings clinical care to your doorstep across Delhi NCR: a trained medic arrives with a full vitals kit, and an MBBS doctor joins live on video to diagnose and prescribe. You get a real medical consultation without the travel, the waiting room, or the exposure.",
    included: [
      {
        heading: "Who delivers your visit",
        body: "Every visit is staffed by a Sanocare medic qualified in GNM or B.Sc Nursing, carrying a calibrated vitals kit (BP, SpO₂, temperature, glucometer). The medic is supervised in real time by an MBBS doctor on live video — so you get both a trained pair of hands at home and a qualified physician's judgement on the same call.",
      },
      {
        heading: "What happens during the visit",
        body: "The medic records vitals, performs the hands-on parts of the examination, and relays findings to the doctor on video. The MBBS doctor takes the history, interprets the vitals, reaches a diagnosis, and issues a signed digital e-prescription under MoHFW Telemedicine Practice Guidelines 2020. If medicines or lab tests are needed, those are arranged on the spot.",
      },
      {
        heading: "Service area & timing",
        body: `Doctor home visits cover ${AREA}. Median time-to-medic is under 30 minutes from booking — we dispatch on demand rather than scheduling for later, because home visits are usually needed now. Standard service hours are 9 AM to 9 PM.`,
      },
      {
        heading: "Pricing & compliance",
        body: "A home visit is ₹499 — that covers the medic visit, the live MBBS doctor consult, and the signed e-prescription, with no add-on charges. Payment is settled transparently with no surprise fees. Consultations follow MoHFW Telemedicine 2020, and your data is handled under India's DPDP Act 2023.",
      },
    ],
    useCases: [
      "An elderly parent feeling unwell who shouldn't or can't travel to a clinic",
      "A child running a fever late at night when no clinic appointment is available",
      "Post-discharge follow-up after a hospital stay or procedure",
      "Routine BP or blood-sugar review for a chronic patient at home",
      "A suspected viral illness where you want a doctor's opinion quickly",
      "A pre-employment or fitness medical examination done at home",
      "A second opinion before deciding whether a hospital visit is needed",
    ],
    howItWorks: HOW_IT_WORKS_INPERSON,
    pricingNote:
      "₹499 per visit — medic + live MBBS doctor consult + signed e-prescription. No add-on charges.",
    faqs: [
      {
        q: "How much does a doctor home visit cost in Delhi?",
        a: "A Sanocare doctor home visit starts at ₹499, which covers the medic's visit, the live MBBS doctor consultation, and a signed digital e-prescription. There are no hidden add-on charges.",
      },
      {
        q: "How long until the medic reaches my home?",
        a: "Median time-to-medic is under 30 minutes from booking across Delhi NCR. Visits are dispatched on demand rather than scheduled, so help is on the way as soon as you confirm.",
      },
      {
        q: "Is the doctor MBBS-qualified?",
        a: "Yes. The home visit is supervised by an MBBS-qualified doctor who joins live on video to diagnose and prescribe, while a GNM / B.Sc Nursing medic handles the in-person examination.",
      },
      {
        q: "Can I get a prescription from a home visit?",
        a: "Yes. The doctor issues a signed digital e-prescription under MoHFW Telemedicine Practice Guidelines 2020, valid at any pharmacy, and saved to your Sanocare Pulse account.",
      },
      {
        q: "Which areas in Delhi do you serve?",
        a: `We currently serve ${AREA}. If you're just outside this area, message us on WhatsApp and we'll confirm whether we can reach you.`,
      },
    ],
  },

  "home-nurse-delhi-ncr": {
    seoSlug: "home-nurse-delhi-ncr",
    serviceSlug: "medic-at-home",
    metaTitle: "Home Nurse in Delhi NCR — Sanocare | From ₹199",
    metaDescription:
      "Trained GNM / B.Sc Nursing medic at home for injections, IV drips, wound dressing and post-surgical care across Delhi NCR. Under 30-minute arrival. From ₹199. Serving Kalkaji & Govindpuri Extension.",
    h1: "Home Nursing Service in Delhi NCR",
    subtitle:
      "From ₹199 · a trained medic at your door in under 30 minutes for injections, IV drips, dressings and more.",
    schemaServiceName: "Home Nursing Service in Delhi NCR",
    serviceType: "Home nursing and medical procedures",
    price: "199",
    breadcrumbName: "Home Nurse Delhi NCR",
    classifierSafe: true,
    intro:
      "Some care doesn't need a full doctor's visit — it needs a trained pair of hands for a specific procedure. Sanocare's home nursing service sends a qualified medic to your door across Delhi NCR for injections, IV drips, wound dressing, suture removal, catheter care and post-surgical support. It's the safe, convenient alternative to repeated clinic trips for routine procedures, ideal for elderly patients and anyone recovering at home.",
    included: [
      {
        heading: "Who delivers your care",
        body: "Home nursing is delivered by a Sanocare medic qualified in GNM or B.Sc Nursing, trained in safe injection technique, IV cannulation, aseptic wound care and post-operative support. They bring sterile single-use supplies for every procedure, so nothing is reused and infection risk stays low.",
      },
      {
        heading: "What the medic can do at home",
        body: "Prescribed injection and IM/IV medication administration, IV drips and infusions, wound dressing and dressing changes, suture and staple removal, catheter and tube care, and standalone vitals checks. If you require a full medical health assessment, please contact your primary healthcare provider. Our doorstep services focus strictly on physical procedure coordination and supportive care execution.",
      },
      {
        heading: "Service area & timing",
        body: `Home nursing covers ${AREA}, with arrival typically under 30 minutes of booking. Standard hours are 9 AM to 9 PM, with extended care available on request for ongoing courses such as a multi-day injection schedule.`,
      },
      {
        heading: "Pricing & compliance",
        body: "Home nursing starts at ₹199 and varies by procedure type — you'll always know the price before the medic arrives. All medics follow standard clinical safety protocols, use sterile single-use consumables, and handle your records under India's DPDP Act 2023.",
      },
    ],
    useCases: [
      "A prescribed course of injections that would otherwise mean daily clinic trips",
      "An IV drip for hydration or prescribed infusion at home",
      "Wound dressing changes after surgery or an injury",
      "Suture or staple removal once a wound has healed",
      "Catheter care or tube management for a bed-bound patient",
      "A standalone BP or blood-sugar check for an elderly relative",
      "Post-surgical nursing support during recovery at home",
    ],
    howItWorks: [
      {
        title: "Book in 60 seconds",
        body: "Tell us the procedure, the patient and your area. Pay 50% to confirm; the balance is settled when the visit completes.",
      },
      {
        title: "Medic dispatched",
        body: "A trained GNM / B.Sc Nursing medic nearest you is assigned and heads over — typically under 30 minutes in Delhi NCR.",
      },
      {
        title: "Procedure at home",
        body: "The medic performs the procedure with sterile single-use supplies, following standard clinical safety protocol.",
      },
      {
        title: "Records & follow-up",
        body: "The visit is logged to your Sanocare Pulse account, and we help schedule the next session if it's part of a course.",
      },
    ],
    pricingNote:
      "From ₹199 per visit, varies by procedure. Covers hands-on care procedures only. Clinical evaluation or diagnostic consultations are not included.",
    faqs: [
      {
        q: "How much does a home nurse cost in Delhi NCR?",
        a: "Home nursing starts at ₹199 per visit and varies by procedure type. You're told the exact price before the medic is dispatched, so there are no surprises.",
      },
      {
        q: "What procedures can a home nurse do?",
        a: "Our qualified assistants handle physical care coordination including injections, IV infusions, dressing changes, suture removal, and wellness vitals monitoring. They do not issue prescriptions or diagnostic evaluations.",
      },
      {
        q: "Are the medics qualified?",
        a: "Yes. Every medic is qualified in GNM or B.Sc Nursing and trained in safe injection technique, IV cannulation and aseptic wound care. They use sterile single-use supplies for every procedure.",
      },
      {
        q: "How quickly can a nurse reach my home?",
        a: "Arrival is typically under 30 minutes of booking across Delhi NCR, since medics are dispatched on demand rather than scheduled for later.",
      },
      {
        q: "Which areas do you cover?",
        a: `Home nursing covers ${AREA}. Message us on WhatsApp if you're nearby and we'll confirm coverage.`,
      },
    ],
  },

  "lab-tests-at-home-delhi": {
    seoSlug: "lab-tests-at-home-delhi",
    serviceSlug: "lab-tests",
    metaTitle: "Lab Tests at Home in Delhi — Sanocare | Free Pickup",
    metaDescription:
      "Free home sample collection by a trained phlebotomist; 1,892 tests via partner laboratories, signed PDF reports within 24h. Serving Kalkaji, Govindpuri Extension & South Delhi. ₹200 collection fee.",
    h1: "Lab Tests at Home in Delhi",
    subtitle:
      "Free phlebotomist pickup · 1,892 tests · reports in 24 hours. ₹200 collection fee + test amount.",
    schemaServiceName: "Lab Tests at Home in Delhi",
    serviceType: "Home diagnostic sample collection",
    price: "200",
    breadcrumbName: "Lab Tests at Home Delhi",
    intro:
      "Skip the diagnostic-centre queue. Sanocare sends a trained phlebotomist to your home across Delhi NCR to collect blood, urine or swab samples, processes them at our partner laboratories, and delivers signed PDF reports to your phone within 24 hours. With 1,892 tests available through our Pathcore partner — from a single parameter to full-body checkups — it's diagnostics on your schedule, without the travel.",
    included: [
      {
        heading: "Who collects your sample",
        body: "A trained Sanocare phlebotomist handles your collection using sterile, single-use equipment and proper sample-handling and cold-chain protocol. Correct technique at the doorstep matters as much as the lab itself — it's what keeps your results accurate.",
      },
      {
        heading: "What's available & how reports arrive",
        body: "Choose from 1,892 tests via Pathcore: routine panels (CBC, lipid, thyroid, HbA1c), doctor-advised tests, and full-body health checkups. Samples are processed at our partner laboratories and your signed PDF report lands on WhatsApp and in your Sanocare Pulse account, typically within 24 hours.",
      },
      {
        heading: "Service area & timing",
        body: `Home collection covers ${AREA}, with a phlebotomist arriving within about 90 minutes of a confirmed slot. Morning collection (ideal for fasting tests) and evening slots are both available, 9 AM to 9 PM.`,
      },
      {
        heading: "Pricing & compliance",
        body: "A flat ₹200 collection fee is paid at booking; the test amount is paid by UPI to the phlebotomist at collection, so you only ever pay for the tests you actually take. All processing is at our partner laboratories, and your data is handled under India's DPDP Act 2023.",
      },
    ],
    useCases: [
      "A routine annual health checkup without taking time off to visit a centre",
      "Doctor-advised tests you need done quickly at home",
      "Regular monitoring panels for diabetes or thyroid management",
      "Fasting blood tests collected first thing in the morning at home",
      "Tests for an elderly or bed-bound patient who can't travel",
      "A pre-employment medical test panel",
      "Follow-up tests after a change in treatment",
    ],
    howItWorks: [
      {
        title: "Pick your tests",
        body: "Search 1,892 tests or upload your doctor's test list, choose a morning or evening slot, and pay the ₹200 collection fee to confirm.",
      },
      {
        title: "Phlebotomist arrives",
        body: "A trained phlebotomist reaches you (usually within 90 minutes of the slot) and collects your sample with sterile, single-use equipment.",
      },
      {
        title: "Partner laboratory processing",
        body: "Pay the test amount by UPI at collection. Samples are processed at our partner laboratories under proper cold-chain handling.",
      },
      {
        title: "Reports in 24 hours",
        body: "Your signed PDF report arrives on WhatsApp and in Sanocare Pulse, typically within 24 hours of collection.",
      },
    ],
    pricingNote:
      "₹200 collection fee at booking + the test amount by UPI at collection. You only pay for the tests you take.",
    faqs: [
      {
        q: "How much do home lab tests cost in Delhi?",
        a: "There's a flat ₹200 home-collection fee paid at booking; the test amount is paid by UPI to the phlebotomist at collection and depends on which of the 1,892 available tests you choose.",
      },
      {
        q: "How are the lab samples processed?",
        a: "Samples are processed at our partner laboratories via Pathcore, following chain-of-custody protocol with collection timestamps and tamper-evident seals. You receive a signed PDF report.",
      },
      {
        q: "How soon will I get my reports?",
        a: "Signed PDF reports are typically delivered within 24 hours of collection, sent to you on WhatsApp and saved in your Sanocare Pulse account.",
      },
      {
        q: "Is home sample collection free?",
        a: "Collection is handled by a trained phlebotomist for a flat ₹200 fee — there's no separate travel or visit charge beyond that, and you only pay for the tests you actually take.",
      },
      {
        q: "Which areas in Delhi do you serve?",
        a: `Home lab collection covers ${AREA}. Message us on WhatsApp to confirm if you're just outside this area.`,
      },
    ],
  },

  "online-doctor-consultation-india": {
    seoSlug: "online-doctor-consultation-india",
    serviceSlug: "teleconsultation",
    metaTitle: "Online Doctor Consultation India — Sanocare | ₹399",
    metaDescription:
      "Video consult with an MBBS doctor in 15 minutes, with the doctor's written advice under MoHFW 2020. Available anywhere in India, no home visit needed. From ₹399 for a 15-minute consultation.",
    h1: "Online Doctor Consultation in India",
    subtitle:
      "From ₹399 · a live video consult with an MBBS doctor in about 15 minutes, with the doctor's written advice.",
    schemaServiceName: "Online Doctor Consultation in India",
    serviceType: "Online medical teleconsultation",
    price: "399",
    breadcrumbName: "Online Doctor Consultation India",
    intro:
      "Not every health concern needs someone to visit. Sanocare's online doctor consultation connects you with an MBBS doctor over live video — anywhere in India — for follow-up consultations for ongoing treatment, second opinions, lifestyle questions and minor concerns. You get real clinical advice under MoHFW Telemedicine 2020 without leaving home or sitting in a clinic queue, usually within 15 minutes of booking.",
    included: [
      {
        heading: "Who you consult",
        body: "Every teleconsultation is with an MBBS-qualified doctor, not a chatbot or a non-clinical agent. The doctor reviews your concern, asks history, and gives clinical advice you can act on — the same standard of consultation you'd expect in a clinic, delivered over video.",
      },
      {
        heading: "What the consultation covers",
        body: "A focused 15-minute video consult: the doctor discusses your symptoms or question, advises on management, and where appropriate issues a signed digital e-prescription under MoHFW Telemedicine Practice Guidelines 2020. Follow-up support continues until your case closes, so you're not left with unanswered questions.",
      },
      {
        heading: "Coverage & timing",
        body: "Because there's no physical visit, online consultations are available anywhere in India — not just Delhi NCR. Live video typically starts within 15 minutes of booking, with no clinic queue. Standard hours are 9 AM to 9 PM.",
      },
      {
        heading: "Pricing & compliance",
        body: "A teleconsultation is ₹399 for a 15-minute consult, with no hidden charges. The doctor's advice is issued under MoHFW Telemedicine 2020; your data is handled under India's DPDP Act 2023.",
      },
    ],
    useCases: [
      "Follow-up consultations for ongoing treatment without a clinic trip",
      "A second opinion on a diagnosis or treatment plan",
      "Lifestyle, diet or treatment questions for a chronic condition",
      "A minor concern — cold, rash, mild infection — that needs a doctor's view",
      "Reviewing lab or test reports with a doctor over video",
      "Quick medical advice while travelling anywhere in India",
      "An after-hours concern when your usual clinic is closed",
    ],
    howItWorks: [
      {
        title: "Book in 60 seconds",
        body: "Tell us who the consult is for and your concern. Pay to confirm and you're in the queue.",
      },
      {
        title: "Doctor matched",
        body: "An available MBBS doctor is matched to you — no need to pick a specialty or schedule for later.",
      },
      {
        title: "Live video consult",
        body: "You get a video link and connect with the doctor, usually within 15 minutes of booking. No clinic queue.",
      },
      {
        title: "Doctor's written advice",
        body: "Where appropriate the doctor shares written advice under MoHFW 2020, saved to your Sanocare Pulse account.",
      },
    ],
    pricingNote:
      "₹399 for a 15-minute consult with an MBBS doctor. No hidden charges.",
    faqs: [
      {
        q: "How much does an online doctor consultation cost in India?",
        a: "A Sanocare online doctor consultation is ₹399 for a 15-minute video consult with an MBBS doctor, including the doctor's written advice where appropriate. There are no hidden charges.",
      },
      {
        q: "Is the doctor MBBS-qualified?",
        a: "Yes. Every teleconsultation is with an MBBS-qualified doctor — not a chatbot — who provides genuine clinical advice you can act on.",
      },
      {
        q: "How quickly can I talk to a doctor?",
        a: "Live video typically starts within about 15 minutes of booking. There's no clinic queue and no need to schedule for later.",
      },
      {
        q: "Will I get the doctor's advice in writing?",
        a: "Where clinically appropriate the doctor issues a signed digital e-prescription under MoHFW Telemedicine 2020, saved to your Sanocare Pulse account.",
      },
      {
        q: "Is online consultation available outside Delhi?",
        a: "Yes. Because there's no physical visit, online doctor consultations are available anywhere in India, not just Delhi NCR.",
      },
    ],
  },
};

/** Stable ordering for cross-links + generateStaticParams. */
export const SERVICE_PAGE_SLUGS = Object.keys(SERVICE_PAGES);
