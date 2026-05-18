// Service pricing configuration
// Sanocare NOW: ₹499 for first 15 minutes | ₹100 per additional 5 minutes

export const BASE_PRICE = 499; // First 15 minutes
export const ADDITIONAL_PRICE_PER_5MIN = 100;

export const SERVICE_PRICING: Record<string, { label: string; price: number; description: string; category: string }> = {
  "homecare": {
    label: "Homecare",
    price: 499,
    description: "Medic-led doorstep execution for acute needs",
    category: "Homecare",
  },
  "teleconsult": {
    label: "Teleconsultation",
    price: 199,
    description: "24/7 virtual access to dedicated MBBS doctors",
    category: "Teleconsultation",
  },
  "chronic": {
    label: "Chronic Disease Management",
    price: 599,
    description: "Specialized monitoring for elderly and long-term health",
    category: "Chronic",
  },
  "diagnostics": {
    label: "Early Risk Diagnostics",
    price: 299,
    description: "Automated screening to detect risks early",
    category: "Diagnostics",
  },
  // Legacy mappings for backward compatibility
  "home-visit": {
    label: "Homecare",
    price: 499,
    description: "Medic-led doorstep execution for acute needs",
    category: "Homecare",
  },
  "nursing": {
    label: "Homecare (Nursing)",
    price: 499,
    description: "Nursing care, injections, wound dressing",
    category: "Homecare",
  },
  "lab": {
    label: "Diagnostics (Lab)",
    price: 299,
    description: "Home sample collection (test charges extra)",
    category: "Diagnostics",
  },
};

export function getServicePrice(serviceCategory: string): number {
  return SERVICE_PRICING[serviceCategory]?.price || 0;
}

export function getServiceLabel(serviceCategory: string): string {
  return SERVICE_PRICING[serviceCategory]?.label || serviceCategory;
}

export function formatPrice(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}
