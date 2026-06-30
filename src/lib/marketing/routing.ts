// Route a marketing lead: score it, set its state, and fire the right channel.
//   - B2B (source=b2b_discovery OR intent ∈ {clinic_partner, society}) → CRM
//     track (state=b2b_prospect). NEVER Aarogya.
//   - B2C hot (score ≥ threshold OR urgency) → ops alert to 919760059900 via the
//     EXISTING aarogya_lead_alert path (sendOpsAlert) — internal alert, not a
//     patient send, so it is not consent-gated.
//   - B2C opted-in → set the Aarogya-nurture flag (consent-gated; the DB CHECK
//     enforces it too). Non-opted-in B2C just gets qualified.

import { supabaseAdmin } from "@/lib/supabase-server";
import { sendOpsAlert } from "@/lib/whatsapp/opsAlert";
import { log } from "@/lib/whatsapp/log";
import { canEnqueueAarogya } from "./consent";
import { marketingLeadToOpsAlert } from "./opsContext";
import { HOT_SCORE_THRESHOLD, scoreLead } from "./scoring";
import { B2B_SERVICE_INTENTS, type LeadState, type MarketingLead } from "./types";

type SupabaseLike = typeof supabaseAdmin;

export interface RouteDecision {
  state: LeadState;
  score: number;
  aarogyaNurture: boolean;
  opsAlerted: boolean;
  track: "b2c" | "b2b";
}

export interface RouteDeps {
  supabase?: SupabaseLike;
  sendOpsAlertFn?: typeof sendOpsAlert;
  /** Clock for scoring recency. */
  now?: number;
  /** Explicit urgency signal from the touch (forces hot). */
  urgencyHigh?: boolean;
  /** Skip the DB write (tests / dry-run). Defaults to persisting. */
  persist?: boolean;
}

function isB2B(lead: MarketingLead): boolean {
  return (
    lead.source === "b2b_discovery" ||
    (lead.service_intent != null && B2B_SERVICE_INTENTS.has(lead.service_intent))
  );
}

export async function routeMarketingLead(
  lead: MarketingLead,
  deps: RouteDeps = {},
): Promise<RouteDecision> {
  const supabase = deps.supabase ?? supabaseAdmin;
  const sendOpsAlertFn = deps.sendOpsAlertFn ?? sendOpsAlert;

  if (isB2B(lead)) {
    await persistRouting(supabase, lead.id, { state: "b2b_prospect", score: lead.score, aarogya_nurture: false }, deps);
    return { state: "b2b_prospect", score: lead.score, aarogyaNurture: false, opsAlerted: false, track: "b2b" };
  }

  const score = scoreLead({
    source: lead.source,
    service_intent: lead.service_intent,
    consent_status: lead.consent_status,
    urgency_high: deps.urgencyHigh,
    created_at: lead.created_at,
    now: deps.now,
  });
  const hot = score >= HOT_SCORE_THRESHOLD || deps.urgencyHigh === true;
  // Consent-gated: aarogya_nurture true ONLY for opted-in (DB CHECK also enforces).
  const aarogyaNurture = canEnqueueAarogya(lead);
  const state: LeadState = hot ? "hot" : aarogyaNurture ? "nurturing" : "qualified";

  await persistRouting(supabase, lead.id, { state, score, aarogya_nurture: aarogyaNurture }, deps);

  let opsAlerted = false;
  if (hot) {
    const res = await sendOpsAlertFn(marketingLeadToOpsAlert({ ...lead, score, state }));
    opsAlerted = res.sent;
  }

  return { state, score, aarogyaNurture, opsAlerted, track: "b2c" };
}

async function persistRouting(
  supabase: SupabaseLike,
  id: string,
  fields: { state: LeadState; score: number; aarogya_nurture: boolean },
  deps: RouteDeps,
): Promise<void> {
  if (deps.persist === false) return;
  const { error } = await supabase
    .from("marketing_leads")
    .update({ ...fields, routed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) log.error("routeMarketingLead persist failed", error.message);
}
