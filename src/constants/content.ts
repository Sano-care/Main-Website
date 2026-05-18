export const COMPANY_INFO = {
  name: "Sanocare",
  tagline: "Reimagining Primary Healthcare for Urban India",
  contact: {
    phone: "+91-9571608318",
    email: "contact@sanocare.in",
    address: "1666/2, Govindpuri Ext., Kalkaji, New Delhi, India",
    // Clean string for Google Maps URL
    mapsLink: "https://www.google.com/maps/search/?api=1&query=1666/2,+Govindpuri+Ext.,+Kalkaji,+New+Delhi"
  }
};

export const HERO_CONTENT = {
  title: "Healthcare at your Doorstep.",
  subtitle: "We bridge the gap between virtual and physical care. Get doctors, nurses, and diagnostics right at your home or within your gated society.",
  cta: "Book a Visit",
  stats: [
    { label: "Response Time", value: "30 Mins" },
    { label: "Doctors", value: "Verified" },
    { label: "Convenience", value: "100%" },
  ]
};

export const SERVICES = [
  {
    id: "home-care",
    title: "Healthcare at Home",
    icon: "home_health", // Material Symbol name
    description: "Qualified doctors visit patients at home for primary consultations, vitals checks, injections, and routine checkups.",
    features: ["Doctor Visits", "Vitals Check", "Wound Dressing"]
  },
  {
    id: "infirmary",
    title: "Community Infirmary",
    icon: "apartment",
    description: "Tech-enabled kiosks installed within gated societies providing on-demand monitoring and preventive screenings.",
    features: ["Smart Kiosks", "Preventive Health", "Tele-consult Integration"]
  },
  {
    id: "paramedic",
    title: "Paramedic & Nursing",
    icon: "medical_services",
    description: "Trained professionals for blood sample collection, injections, dressing changes, and chronic disease support.",
    features: ["Lab Collection", "Injections", "Diabetes Support"]
  },
  {
    id: "telehealth",
    title: "Teleconsultations",
    icon: "video_call",
    description: "Virtual access to licensed doctors for general health concerns, prescription refills, and follow-up guidance.",
    features: ["Video Call", "Digital Rx", "Follow-ups"]
  }
];

export const DOCTORS = [
  {
    name: "Dr. Sanyam Arora",
    role: "Physician",
    qualification: "MBBS, MD Anatomy"
  },
  {
    name: "Dr. Ranjendra Pal Arora",
    role: "Pediatrician",
    qualification: "BAMS"
  }
];

export const BENEFITS = [
  { title: "Convenience & Speed", desc: "Avoid long queues — get care at home." },
  { title: "Preventive & Proactive", desc: "Regular monitoring ensures early detection." },
  { title: "Family Management", desc: "Track medical history for the entire family." },
  { title: "Tech-Driven", desc: "AI insights and digital prescriptions." }
];