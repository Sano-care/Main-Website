import {
  Activity,
  Award,
  Baby,
  BadgeCheck,
  Brain,
  Building2,
  CheckCircle,
  Clock,
  FileText,
  Globe,
  HandHeart,
  Heart,
  HeartPulse,
  Home,
  IndianRupee,
  Lightbulb,
  Mail,
  MapPin,
  Mic,
  Newspaper,
  Phone,
  Shield,
  Stethoscope,
  Syringe,
  Target,
  TestTube,
  Thermometer,
  UserCheck,
  Users,
  Video,
} from "lucide-react";

export const SERVICES_PAGE_CONTENT = {
  pageCopy: {
    hero: {
      badge: "Doorstep Medical Excellence",
      titlePrefix: "Comprehensive Care,",
      titleHighlight: "Tailored for You.",
      description:
        "From preventive diagnostics to home nursing care, our team of paramedics, nurses, and doctors provides a seamless continuum of healthcare services-right at your doorstep.",
      primaryCtaLabel: "Book a Consultation",
      primaryCtaHref: "/#hero-booking-form",
      secondaryCtaLabel: "View Pricing",
      secondaryCtaHref: "/now",
      imageSrc:
        "https://images.unsplash.com/photo-1631815588090-d4bfec5b1ccb?q=80&w=2940&auto=format&fit=crop",
      imageAlt: "Healthcare professional with patient",
      floatingCardLabel: "Rapid Response",
      floatingCardText: "Paramedics at your doorstep within 30 minutes of booking.",
    },
    servicesSection: {
      badge: "Our Services",
      title: "Healthcare Excellence at Your Doorstep",
      description:
        "We bring comprehensive medical services to your home, eliminating the need for hospital visits while maintaining the highest standards of care.",
      cardCtaLabel: "Learn More",
    },
    advantageSection: {
      badge: "The Sanocare Advantage",
      title: "Why Choose Our Care",
      description:
        "We go beyond traditional healthcare by bringing medical excellence directly to your home. Your journey with us is designed to be as stress-free as it is healing.",
      imageSrc:
        "https://images.unsplash.com/photo-1576091160550-2173dba999ef?q=80&w=2940&auto=format&fit=crop",
      imageAlt: "Healthcare professional caring for patient",
    },
    programsSection: {
      badge: "Specialized Programs",
      title: "Beyond Individual Care",
      cardCtaLabel: "Explore Program",
    },
    trustSectionLabel: "Trusted by Thousands Across Delhi NCR",
    ctaSection: {
      title: "Ready to Experience Better Healthcare?",
      description:
        "Book a consultation now and get professional medical care at your doorstep within 30 minutes.",
      primaryCtaLabel: "Book a Visit",
      primaryCtaHref: "/#hero-booking-form",
      secondaryCtaLabel: "Call: +91-9571608318",
      secondaryCtaHref: "tel:+919571608318",
    },
  },
  medicalServices: [
    {
      id: "homecare",
      title: "Homecare Services",
      description:
        "Professional paramedics and nurses at your doorstep for comprehensive in-home medical care, vitals monitoring, and nursing support.",
      icon: Home,
      link: "/now",
    },
    {
      id: "teleconsult",
      title: "Teleconsultation",
      description:
        "Video consultations with qualified doctors from the comfort of your home. Get prescriptions and follow-up care digitally.",
      icon: Video,
      link: "/now",
    },
    {
      id: "chronic",
      title: "Chronic Care Management",
      description:
        "Structured care programs for diabetes, hypertension, and other chronic conditions with regular monitoring and support.",
      icon: Activity,
      link: "/now",
    },
    {
      id: "diagnostics",
      title: "Home Diagnostics",
      description:
        "Blood tests, ECG, and comprehensive health screenings conducted at your home with rapid results delivery.",
      icon: TestTube,
      link: "/now",
    },
    {
      id: "pediatrics",
      title: "Pediatric Care",
      description:
        "Dedicated healthcare for infants, children, and adolescents with gentle, family-friendly care at home.",
      icon: Baby,
      link: "/now",
    },
    {
      id: "elderly",
      title: "Elderly Care",
      description:
        "Specialized care programs for senior citizens including mobility support, medication management, and companionship.",
      icon: Heart,
      link: "/now",
    },
  ],
  advantagePoints: [
    {
      number: "01",
      title: "30-Minute Response",
      description:
        "Our paramedics and nurses are dispatched immediately. We guarantee arrival within 30 minutes in our coverage areas.",
    },
    {
      number: "02",
      title: "Qualified Professionals",
      description:
        "All our healthcare workers are certified ANMs, DNMs, and trained paramedics with verified backgrounds.",
    },
    {
      number: "03",
      title: "Transparent Pricing",
      description:
        "No hidden fees, no surge pricing. Fixed rates starting at ₹499 for home visits with all costs disclosed upfront.",
    },
  ],
  signaturePrograms: [
    {
      title: "CareHub for Societies",
      description:
        "Transform your gated community into a health-first environment with dedicated on-site paramedics and priority response.",
      icon: Users,
      link: "/carehub",
    },
    {
      title: "Corporate Wellness",
      description:
        "Comprehensive employee health programs including on-site health camps, teleconsultations, and emergency response.",
      icon: Target,
      link: "/contact",
    },
    {
      title: "Post-Surgery Recovery",
      description:
        "Structured home-based recovery programs with regular paramedic visits, wound care, and physiotherapy support.",
      icon: HandHeart,
      link: "/now",
    },
  ],
  trustBadges: [
    { icon: UserCheck, name: "Verified Paramedics", desc: "Background Checked" },
    { icon: Shield, name: "DISHA Compliant", desc: "Data Security" },
    { icon: Clock, name: "24/7 Support", desc: "Always Available" },
    { icon: FileText, name: "Licensed & Insured", desc: "Fully Accredited" },
  ],
};

export const NOW_PAGE_CONTENT = {
  pageCopy: {
    hero: {
      badge: "Direct to Consumer",
      titlePrefix: "Sanocare",
      titleHighlight: "NOW",
      description:
        "Healthcare that comes to you. Get paramedics, nurses, and diagnostics at your doorstep within 30 minutes. No appointments, no waiting rooms.",
      primaryCtaLabel: "Book a Visit Now",
      primaryCtaHref: "/#hero-booking-form",
      secondaryCtaLabel: "+91-9571608318",
      secondaryCtaHref: "tel:+919571608318",
      imageSrc:
        "https://images.unsplash.com/photo-1584820927498-cfe5211fd8bf?q=80&w=2942&auto=format&fit=crop",
      imageAlt: "Healthcare professional at home visit",
      floatingCardLabel: "Quick Response",
      floatingCardText: "Our team reaches you in under 30 minutes, guaranteed.",
    },
    servicesSection: {
      badge: "Our Services",
      title: "What We Bring to Your Door",
      description: "Comprehensive healthcare services delivered by verified, trained professionals.",
    },
    processSection: {
      badge: "Simple Process",
      title: "How It Works",
      description: "Getting healthcare at home is simple with Sanocare NOW. Just four easy steps.",
      imageSrc:
        "https://images.unsplash.com/photo-1631815588090-d4bfec5b1ccb?q=80&w=2864&auto=format&fit=crop",
      imageAlt: "Healthcare at home",
    },
    advantagesSection: {
      badge: "Why Sanocare NOW",
      title: "Healthcare, Redefined",
    },
    pricingCard: {
      badge: "Transparent Pricing",
      startingAtLabel: "Starting at just",
      price: "₹499",
      subtitle: "for 15-minute consultation",
      ctaLabel: "Book Your Visit",
      ctaHref: "/#hero-booking-form",
    },
    trustSection: {
      badge: "Trust & Safety",
      title: "Your Safety is Our Priority",
      description:
        "Every Sanocare NOW professional undergoes rigorous background verification, skill assessment, and regular training to ensure you receive the best care.",
      imageSrc:
        "https://images.unsplash.com/photo-1576091160550-2173dba999ef?q=80&w=2940&auto=format&fit=crop",
      imageAlt: "Healthcare professional",
    },
    ctaSection: {
      title: "Need Healthcare Now?",
      description:
        "Don't wait in queues. Get professional medical care at your doorstep within 30 minutes.",
      primaryCtaLabel: "Book a Visit",
      primaryCtaHref: "/#hero-booking-form",
      secondaryCtaLabel: "Emergency? Call Now",
      secondaryCtaHref: "tel:+919571608318",
    },
  },
  services: [
    {
      icon: Stethoscope,
      title: "Paramedic Home Visit",
      description:
        "Trained paramedics at your doorstep for consultations, vitals checks, and initial assessments",
      price: "₹499",
      duration: "15 mins",
    },
    {
      icon: Syringe,
      title: "Nursing & Injections",
      description:
        "IV administration, injections, wound dressing, and post-operative care by trained nurses",
      price: "₹349",
      duration: "Per visit",
    },
    {
      icon: HeartPulse,
      title: "Vitals Monitoring",
      description:
        "BP, SpO2, temperature, blood sugar monitoring with digital records",
      price: "₹199",
      duration: "Per check",
    },
    {
      icon: TestTube,
      title: "Lab Sample Collection",
      description:
        "Blood tests, urine tests, and other diagnostic sample collection at home",
      price: "₹99",
      duration: "+ Lab fees",
    },
    {
      icon: Thermometer,
      title: "Chronic Care Visits",
      description:
        "Regular monitoring visits for diabetes, hypertension, and other chronic conditions",
      price: "₹399",
      duration: "Per visit",
    },
    {
      icon: Activity,
      title: "ECG at Home",
      description:
        "12-lead ECG with immediate digital report shared with you and your doctor",
      price: "₹599",
      duration: "With report",
    },
  ],
  howItWorks: [
    {
      step: "01",
      title: "Book Online",
      description: "Fill the quick form or call us. Tell us your symptoms and location.",
      icon: Phone,
    },
    {
      step: "02",
      title: "We Dispatch",
      description: "Nearest available paramedic is dispatched to your location immediately.",
      icon: MapPin,
    },
    {
      step: "03",
      title: "Care at Home",
      description: "Receive professional care in the comfort of your home within 30 minutes.",
      icon: Home,
    },
    {
      step: "04",
      title: "Digital Records",
      description: "Get prescriptions and reports digitally on WhatsApp and email.",
      icon: FileText,
    },
  ],
  advantages: [
    {
      title: "No Waiting Rooms",
      description: "Skip the queues. Healthcare comes to your doorstep.",
    },
    {
      title: "Transparent Pricing",
      description: "Know the cost upfront. No hidden fees or surprises.",
    },
    {
      title: "Trained Professionals",
      description: "All staff are verified, certified, and background-checked.",
    },
  ],
  stats: [
    { icon: Clock, value: "30 Min", label: "Response Time" },
    { icon: IndianRupee, value: "₹499", label: "Starting Price" },
    { icon: BadgeCheck, value: "100%", label: "Verified Staff" },
    { icon: FileText, value: "Digital", label: "Health Records" },
  ],
  pricingPoints: [
    "Base consultation: ₹499 for first 15 minutes",
    "Additional time: ₹100 per 5 minutes",
    "Lab tests: Sample collection ₹99 + lab fees",
    "Nursing: Starting ₹349 per visit",
    "ECG at home: ₹599 with digital report",
  ],
  trustPoints: [
    "Aadhar and police verification for all staff",
    "Certified paramedics and trained nurses only",
    "Real-time tracking of your caregiver",
    "Digital records shared with you instantly",
    "24/7 customer support for any concerns",
  ],
};

export const CAREHUB_PAGE_CONTENT = {
  pageCopy: {
    hero: {
      badge: "For Gated Communities",
      titlePrefix: "CareHub for",
      titleHighlight: "Your Society",
      description:
        "Transform your gated community into a health-first neighborhood with dedicated healthcare infrastructure, priority response, and resident wellness programs.",
      primaryCtaLabel: "Request CareHub",
      primaryCtaHref: "#inquiry-form",
      secondaryCtaLabel: "Talk to Us",
      secondaryCtaHref: "tel:+919571608318",
      imageSrc:
        "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=2940&auto=format&fit=crop",
      imageAlt: "Modern residential society",
      floatingCardLabel: "Priority Care",
      floatingCardText: "Response time under 15 minutes for all CareHub residents.",
    },
    benefitsSection: {
      badge: "CareHub Benefits",
      title: "What Your Society Gets",
      description:
        "A comprehensive healthcare solution designed specifically for residential communities.",
    },
    processSection: {
      badge: "Simple Process",
      title: "How CareHub Works",
      description:
        "Getting CareHub for your society is simple. We handle everything from assessment to implementation.",
      imageSrc:
        "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?q=80&w=2940&auto=format&fit=crop",
      imageAlt: "Community healthcare",
    },
    inquirySection: {
      badge: "Get Started",
      title: "Request CareHub for Your Society",
      description:
        "Fill out the form and our partnership team will reach out within 24 hours to discuss how CareHub can transform healthcare in your community.",
      directTalkLabel: "Prefer to talk directly?",
      directTalkPhone: "+91-9571608318",
      successTitle: "Request Submitted!",
      successCtaLabel: "Submit Another Inquiry",
      formTitle: "Society Inquiry Form",
      within24HoursNote: "Our team will contact you within 24 hours",
    },
    formFields: {
      contactNameLabel: "Your Name",
      contactNamePlaceholder: "Contact Person Name",
      phoneLabel: "Phone Number",
      phonePlaceholder: "+91 98765 43210",
      emailLabel: "Email Address",
      emailPlaceholder: "your@email.com",
      societyNameLabel: "Society / Complex Name",
      societyNamePlaceholder: "e.g., Green Valley Apartments",
      locationLabel: "Location / Area",
      locationPlaceholder: "e.g., Sector 62, Noida",
      totalFlatsLabel: "Total Flats (Approx)",
      totalFlatsPlaceholder: "e.g., 500",
      messageLabel: "Additional Message (Optional)",
      messagePlaceholder: "Tell us about your society's healthcare needs...",
      submitLabel: "Request CareHub",
      submittingLabel: "Submitting...",
    },
    ctaSection: {
      title: "Join the Health-First Community Movement",
      description: "50+ societies have already transformed their healthcare. Is yours next?",
      primaryCtaLabel: "Get CareHub",
      primaryCtaHref: "#inquiry-form",
      secondaryCtaLabel: "Call Us",
      secondaryCtaHref: "tel:+919571608318",
    },
  },
  benefits: [
    {
      icon: Clock,
      title: "Priority Response",
      description:
        "Dedicated response team with <15 min arrival time for society residents. No more waiting.",
    },
    {
      icon: Shield,
      title: "Dedicated Care Team",
      description:
        "Assigned paramedics and nurses who know your community and residents personally.",
    },
    {
      icon: Activity,
      title: "Health Dashboard",
      description:
        "Society-wide health analytics, resident tracking, and emergency response monitoring.",
    },
    {
      icon: Heart,
      title: "Preventive Programs",
      description:
        "Regular health camps, screenings, vaccinations, and wellness drives for all age groups.",
    },
    {
      icon: Users,
      title: "Family Health Records",
      description:
        "Centralized digital health records for all family members, accessible anytime.",
    },
    {
      icon: Building2,
      title: "On-site Clinic Option",
      description:
        "Setup of mini health center within your society premises with regular OPD hours.",
    },
  ],
  howItWorks: [
    {
      step: "01",
      title: "Society Inquiry",
      description:
        "RWA or management submits an inquiry. We conduct a free health infrastructure assessment.",
    },
    {
      step: "02",
      title: "Custom Plan",
      description:
        "We design a tailored healthcare plan based on society size, demographics, and needs.",
    },
    {
      step: "03",
      title: "Onboarding",
      description:
        "Dedicated team assigned, resident registration, and emergency protocols established.",
    },
    {
      step: "04",
      title: "Go Live",
      description:
        "24/7 healthcare support activated. Regular health camps and monitoring begins.",
    },
  ],
  stats: [
    { value: "<15 min", label: "Priority Response" },
    { value: "24/7", label: "Dedicated Support" },
    { value: "50+", label: "Societies Trust Us" },
    { value: "10,000+", label: "Families Covered" },
  ],
  inquiryBenefits: [
    "Free consultation and community health assessment",
    "Customized plans based on society size and needs",
    "No upfront infrastructure costs",
    "Flexible subscription models for residents",
  ],
};

export const CONTACT_PAGE_CONTENT = {
  pageCopy: {
    hero: {
      titlePrefix: "Get in",
      titleHighlight: "Touch",
      description:
        "Have questions about our services? Want to partner with us? Or just want to say hello? We'd love to hear from you.",
    },
    formSection: {
      title: "Send Us a Message",
      successTitle: "Message Sent!",
      successCtaLabel: "Send Another Message",
      fields: {
        nameLabel: "Your Name",
        namePlaceholder: "Full Name",
        phoneLabel: "Phone Number",
        phonePlaceholder: "+91 98765 43210",
        emailLabel: "Email Address",
        emailPlaceholder: "your@email.com",
        subjectLabel: "Subject",
        subjectPlaceholder: "What is this regarding?",
        messageLabel: "Your Message",
        messagePlaceholder: "Tell us how we can help you...",
      },
      submitLabel: "Send Message",
      submittingLabel: "Sending...",
    },
    mapSection: {
      title: "Find Us",
      iframeTitle: "Sanocare Location",
      serviceAreasTitle: "Service Areas",
      serviceAreasDescription:
        "We currently serve Delhi NCR including South Delhi, Noida, Gurgaon, Faridabad, and Ghaziabad. Expanding to more cities soon!",
      mapEmbedUrl:
        "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3505.0!2d77.26!3d28.54!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2sGovindpuri%20Extension%2C%20Kalkaji%2C%20New%20Delhi!5e0!3m2!1sen!2sin!4v1600000000000!5m2!1sen!2sin",
    },
    faqCta: {
      title: "Have Questions About Our Services?",
      description: "Check out our services page or book a free consultation call with our team.",
      primaryCtaLabel: "View Services",
      primaryCtaHref: "/services",
      secondaryCtaLabel: "Call Us Now",
      secondaryCtaHref: "tel:+919571608318",
    },
  },
  contactInfo: [
    {
      icon: MapPin,
      title: "Visit Us",
      details: ["1666/2, Govindpuri Ext.", "Kalkaji, New Delhi, India"],
      link: "https://www.google.com/maps/search/?api=1&query=1666/2,+Govindpuri+Ext.,+Kalkaji,+New+Delhi",
      linkText: "Get Directions",
    },
    {
      icon: Phone,
      title: "Call Us",
      details: ["+91-9571608318", "Mon-Sat: 8AM - 10PM"],
      link: "tel:+919571608318",
      linkText: "Call Now",
    },
    {
      icon: Mail,
      title: "Email Us",
      details: ["contact@sanocare.in", "support@sanocare.in"],
      link: "mailto:contact@sanocare.in",
      linkText: "Send Email",
    },
    {
      icon: Clock,
      title: "Working Hours",
      details: ["Mon - Sat: 8:00 AM - 10:00 PM", "Sunday: 9:00 AM - 6:00 PM"],
      link: null,
      linkText: null,
    },
  ],
};

export const RESEARCH_PAGE_CONTENT = {
  pageCopy: {
    hero: {
      badge: "Knowledge Hub",
      titlePrefix: "Health",
      titleHighlight: "Insights",
      titleSuffix: "& Resources",
      description:
        "Stay informed with the latest healthcare trends, expert tips, and data-driven insights. Your go-to resource for making smarter health decisions.",
      primaryCtaLabel: "Explore Articles",
      primaryCtaHref: "#blogs",
      secondaryCtaLabel: "View Health Facts",
      secondaryCtaHref: "#facts",
      imageSrc:
        "https://images.unsplash.com/photo-1576091160550-2173dba999ef?q=80&w=2940&auto=format&fit=crop",
      imageAlt: "Healthcare insights and knowledge",
      floatingCardLabel: "Updated Weekly",
      floatingCardText: "Fresh insights and health tips curated by our medical experts.",
    },
    factsSection: {
      badge: "Did You Know?",
      title: "Healthcare Facts & Figures",
    },
    featuredBlogsSection: {
      badge: "Featured Articles",
      title: "Latest from Our Blog",
      description: "Expert insights, health tips, and stories from the frontlines of home healthcare.",
      cardCtaLabel: "Read More",
      viewAllLabel: "View All Articles",
      viewAllHref: "/blog",
    },
    tipsSection: {
      badge: "Expert Tips",
      title: "Quick Health Tips",
      description:
        "Simple, actionable advice from our medical professionals to help you stay healthy and make informed decisions about your care.",
      quote:
        "Prevention is better than cure. Regular health monitoring at home has helped us catch potential issues early and provide timely interventions for our patients.",
      quoteAuthor: "Dr. Medical Team",
      quoteRole: "Sanocare Health Experts",
    },
    mediaSection: {
      badge: "In The Press",
      title: "Media & Mentions",
    },
    ctaSection: {
      title: "Stay Updated on Health Insights",
      description: "Get the latest health tips, articles, and updates delivered to your inbox.",
      primaryCtaLabel: "Book a Health Checkup",
      primaryCtaHref: "/#hero-booking-form",
      secondaryCtaLabel: "Contact Us",
      secondaryCtaHref: "/contact",
    },
  },
  healthFacts: [
    {
      stat: "73%",
      label: "of urban patients prefer home healthcare for non-emergency needs",
      source: "Urban Health Survey 2025",
    },
    {
      stat: "45 min",
      label: "average time saved per medical visit with doorstep care",
      source: "Sanocare Data",
    },
    {
      stat: "89%",
      label: "patient satisfaction rate with Sanocare services",
      source: "Customer Feedback",
    },
    {
      stat: "62%",
      label: "reduction in hospital readmissions with home follow-up care",
      source: "Clinical Outcomes Study",
    },
  ],
  featuredBlogs: [
    {
      title: "Home-Based Primary Care: A Viable Model for Urban India",
      excerpt:
        "Exploring how doorstep healthcare is transforming the way urban families access medical services...",
      category: "Healthcare Trends",
      readTime: "5 min read",
      image:
        "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?q=80&w=2940&auto=format&fit=crop",
      slug: "home-based-primary-care",
    },
    {
      title: "The Rise of Telemedicine in Post-Pandemic India",
      excerpt:
        "How virtual consultations have become an integral part of the healthcare ecosystem...",
      category: "Digital Health",
      readTime: "4 min read",
      image:
        "https://images.unsplash.com/photo-1576091160550-2173dba999ef?q=80&w=2940&auto=format&fit=crop",
      slug: "telemedicine-india",
    },
    {
      title: "Managing Chronic Diseases at Home: A Complete Guide",
      excerpt:
        "Tips and best practices for monitoring diabetes, hypertension, and cardiac conditions from home...",
      category: "Health Tips",
      readTime: "7 min read",
      image:
        "https://images.unsplash.com/photo-1559757175-5700dde675bc?q=80&w=2940&auto=format&fit=crop",
      slug: "managing-chronic-diseases",
    },
  ],
  healthTips: [
    {
      icon: Heart,
      title: "Monitor Your Vitals Weekly",
      description:
        "Regular tracking of BP, heart rate, and blood sugar can help detect issues early.",
    },
    {
      icon: Clock,
      title: "Don't Delay Emergency Care",
      description:
        "Chest pain, severe breathing difficulty, or stroke symptoms need immediate attention.",
    },
    {
      icon: Lightbulb,
      title: "Keep Digital Health Records",
      description:
        "Store your prescriptions and reports digitally for quick access during emergencies.",
    },
    {
      icon: Users,
      title: "Schedule Regular Checkups",
      description:
        "Preventive screenings can catch potential health issues before they become serious.",
    },
  ],
  mediaMentions: [
    {
      outlet: "Economic Times",
      title: "Sanocare disrupting home healthcare in Delhi NCR",
      type: "Article",
      icon: Newspaper,
    },
    {
      outlet: "Healthcare Executive",
      title: "Interview: Building scalable homecare infrastructure",
      type: "Interview",
      icon: Mic,
    },
    {
      outlet: "StartupNews",
      title: "How Sanocare achieved 30-min response times",
      type: "Feature",
      icon: Video,
    },
  ],
};

export const ABOUT_PAGE_CONTENT = {
  pageCopy: {
    hero: {
      trustPrefix: "Establishing Trust Since",
      titlePrefix: "Our Mission is",
      titleHighlight: "Your Health.",
      description:
        "{companyName} was founded on the principle that premium healthcare should be as seamless as it is effective. We bridge the gap between medical excellence and human compassion.",
      ctaLabel: "Meet Our Specialists",
      ctaHref: "/#specialists",
    },
    whoWeAre: {
      badge: "Who We Are",
      title: "Redefining the standard of homecare.",
      paragraphs: [
        "{companyName} is an integrated healthcare ecosystem designed for the modern family. We believe that clinical expertise should be complemented by convenience and compassion.",
        "Our multidisciplinary approach ensures that every aspect of your well-being is considered, from home consultations to advanced diagnostic services. We are not just a service; we are your lifelong partner in health.",
      ],
    },
    valuesSection: {
      badge: "Our Core Values",
      titlePrefix: "The Pillars of",
    },
    teamSection: {
      badge: "Expertise",
      title: "Visionary Leadership",
      description:
        "Driven by a team of dedicated healthcare professionals committed to transforming homecare delivery.",
    },
    timelineSection: {
      badge: "Our Heritage",
      titlePrefix: "The",
      titleSuffix: "Story",
      description: "Milestones that defined our path toward excellence.",
    },
    accreditationsLabel: "Accredited by Leading Health Organizations",
    ctaSection: {
      title: "Ready to Experience Better Healthcare?",
      description:
        "Book your first home visit today and see why thousands of families trust us with their healthcare needs.",
      ctaLabel: "Book a Visit",
      ctaHref: "/",
    },
  },
  companyInfo: {
    name: "SanoCare",
    tagline: "Your Health, Our Mission",
    foundingYear: "2020",
    city: "[City]",
    state: "[State]",
    fullAddress: "[Full Address]",
    phone: "+91 XXXXX XXXXX",
    email: "contact@sanocare.in",
    founderName: "[Founder Name]",
    founderTitle: "Founder & CEO",
    founderQuote:
      "We don't just treat patients; we empower people to live their healthiest lives.",
  },
  stats: [
    { number: "10,000+", label: "Patients Served" },
    { number: "500+", label: "Home Visits Monthly" },
    { number: "50+", label: "Healthcare Professionals" },
    { number: "98%", label: "Patient Satisfaction" },
  ],
  pillars: [
    {
      number: "01",
      title: "The Vision",
      description:
        "To be the leading homecare provider, making quality medical care accessible to every household.",
    },
    {
      number: "02",
      title: "The Method",
      description:
        "Integrating technology with compassionate care for seamless healthcare delivery at your doorstep.",
    },
    {
      number: "03",
      title: "The Impact",
      description:
        "Positively influencing the lives of thousands of families by bringing healthcare home.",
    },
  ],
  values: [
    {
      icon: BadgeCheck,
      title: "Uncompromising Quality",
      description:
        "We adhere to the highest medical standards, ensuring safety and precision in every home visit and consultation.",
    },
    {
      icon: Brain,
      title: "Empathetic Innovation",
      description:
        "Technology serves the human experience. We innovate to make healthcare more accessible and comfortable.",
    },
    {
      icon: Globe,
      title: "Community First",
      description:
        "Health is a universal right. We work to foster a community that supports health awareness and education.",
    },
  ],
  milestones: [
    {
      year: "[Year]",
      title: "The Foundation",
      description:
        "Started with a vision to transform homecare, making quality medical care accessible to every family.",
      position: "right",
    },
    {
      year: "[Year]",
      title: "First 1,000 Patients",
      description:
        "Reached our first major milestone, establishing trust within the community through consistent, quality care.",
      position: "left",
    },
    {
      year: "[Year]",
      title: "Team Expansion",
      description:
        "Grew our network to include highly qualified doctors, nurses, and lab technicians across the city.",
      position: "right",
    },
    {
      year: "Today",
      title: "Leading Homecare",
      description:
        "Serving thousands of families with comprehensive homecare services including teleconsultation and lab tests.",
      position: "left",
    },
  ],
  teamMembers: [
    { key: "member_1", name: "[Team Member 1]", role: "Chief Medical Officer" },
    { key: "member_2", name: "[Team Member 2]", role: "Head of Operations" },
    { key: "member_3", name: "[Team Member 3]", role: "Director of Nursing" },
    { key: "member_4", name: "[Team Member 4]", role: "Patient Experience Lead" },
  ],
  accreditations: [
    { icon: Shield, name: "NABH" },
    { icon: Award, name: "ISO Certified" },
    { icon: Heart, name: "HealthTrust" },
    { icon: CheckCircle, name: "QualityCare" },
  ],
};

