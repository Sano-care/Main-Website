// Scoring v0 — deterministic fit + intent + recency, capped 0–100. A clean seam
// for later tuning (ML / per-campaign weights). Pure: inject `now` for tests.

import type { ConsentStatus, MarketingSource, ServiceIntent } from "./types";

export const HOT_SCORE_THRESHOLD = 70;

/** Fit (0–40): how qualified the source channel tends to be. */
const SOURCE_FIT: Record<MarketingSource, number> = {
  website_book: 40, // started a booking on-site
  google_lead_form: 35,
  meta_lead_ad: 30,
  meta_ctwa: 30, // click-to-WhatsApp
  website_callback: 25,
  whatsapp_inbound: 25,
  justdial: 20,
  b2b_discovery: 15,
};

export interface ScoreInput {
  source: MarketingSource;
  service_intent?: ServiceIntent | null;
  consent_status: ConsentStatus;
  urgency_high?: boolean;
  /** ISO timestamp of the touch; recency is measured against `now`. */
  created_at?: string | null;
  now?: number;
}

function recencyPoints(input: ScoreInput): number {
  if (!input.created_at) return 25; // a touch with no timestamp is treated as fresh
  const now = input.now ?? Date.parse("2026-06-30T00:00:00Z");
  const ageHours = (now - Date.parse(input.created_at)) / 3_600_000;
  if (ageHours <= 1) return 25;
  if (ageHours <= 24) return 18;
  if (ageHours <= 72) return 10;
  if (ageHours <= 168) return 5;
  return 0;
}

/** Deterministic 0–100 lead score. */
export function scoreLead(input: ScoreInput): number {
  let score = 0;

  // Fit (0–40)
  score += SOURCE_FIT[input.source] ?? 10;

  // Intent (0–35): a concrete service need + consent strength + urgency.
  if (input.service_intent) score += 15;
  if (input.consent_status === "opted_in") score += 12;
  else if (input.consent_status === "pending") score += 5;
  if (input.urgency_high) score += 8;

  // Recency (0–25)
  score += recencyPoints(input);

  return Math.max(0, Math.min(100, score));
}
