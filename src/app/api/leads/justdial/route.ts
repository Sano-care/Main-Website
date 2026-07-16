import { timingSafeEqual } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase-server";
import { upsertMarketingLead } from "@/lib/marketing/leadIntake";
import { normalizeEmail, normalizePhone } from "@/lib/marketing/types";
import { buildJdNotes, mapJdCategory } from "@/lib/marketing/justdial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Plain-text responses — JD expects a simple SUCCESS body; ANY non-200 triggers
// their retry, so after the key gate we always 200 (logging failures loudly)
// to avoid retry storms.
const SUCCESS = () => new Response("SUCCESS", { status: 200, headers: { "content-type": "text/plain" } });
const FORBIDDEN = () => new Response("FORBIDDEN", { status: 403, headers: { "content-type": "text/plain" } });

function keyOk(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * GET /api/leads/justdial?key=…&leadid=…&mobile=… — JustDial CRM lead push.
 * JD pushes each new lead as a GET with query params. We ingest into
 * marketing_leads (source=justdial) + ops-alert. NO WhatsApp template to the
 * lead from here (that's a separate throttled, founder-gated path).
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const get = (k: string) => (sp.get(k) ?? "").trim();
  const leadid = get("leadid") || "unknown";

  // Auth — fail closed if the env secret is unset.
  const expected = process.env.JD_LEAD_PUSH_KEY;
  if (!expected) {
    console.error(`[jd] JD_LEAD_PUSH_KEY unset — refusing (leadid=${leadid})`);
    return FORBIDDEN();
  }
  if (!keyOk(sp.get("key") ?? "", expected)) {
    console.warn(`[jd] bad key — 403 (leadid=${leadid})`);
    return FORBIDDEN();
  }

  const phone = normalizePhone(get("mobile") || get("phone"));
  const email = normalizeEmail(get("email"));
  const category = get("category");
  const area = get("area") || get("brancharea");
  const city = get("city");
  const pincode = get("pincode") || get("branchpin");

  console.log(`[jd] hit leadid=${leadid} phone=${phone ? "y" : "n"} email=${email ? "y" : "n"} category="${category}"`);

  // No contact at all → don't insert a junk row; audit + 200 so JD stops retrying.
  if (!phone && !email) {
    try {
      await supabaseAdmin
        .from("audit_log")
        .insert({ event_type: "jd_lead_no_contact", event_data: { leadid, category } });
    } catch (e) {
      console.error(`[jd] no-contact audit insert failed (leadid=${leadid})`, e);
    }
    console.log(`[jd] no-contact leadid=${leadid} — SUCCESS, no insert`);
    return SUCCESS();
  }

  const fields = {
    leadid,
    prefix: get("prefix"),
    name: get("name"),
    category,
    area,
    city,
    pincode,
    phone: phone ?? (get("mobile") || get("phone")),
  };

  // Insert/dedupe via the ONE marketing writer (dedupes on phone else email;
  // merges attribution). `created=false` on a repeat push (JD retry / same
  // person) → no duplicate row and no duplicate alert.
  const { lead, created, error } = await upsertMarketingLead({
    source: "justdial",
    campaign: "jd_listing",
    contact: { phone: phone ?? undefined, email: email ?? undefined },
    service_intent: mapJdCategory(category),
    consent_status: "pending",
    notes: buildJdNotes(fields),
  });

  if (error || !lead) {
    // Logged loudly; still 200 to avoid a JD retry storm on a persistent error.
    console.error(`[jd] upsert failed leadid=${leadid}: ${error ?? "no lead"}`);
    return SUCCESS();
  }

  // Lead Engine P1 (2026-07-16 founder re-architecture): ingest NO LONGER pings
  // ops. A newly-created pending lead is picked up by the throttled Aarogya
  // engagement sweep (first-contact template), then Aarogya qualifies, and ONLY
  // a qualified lead is forwarded to ops. Nothing to enqueue here — the lead
  // sits `engagement_state='none'` for the sweep.
  console.log(`[jd] leadid=${leadid} lead_id=${lead.id} created=${created} → engagement sweep will pick up`);
  return SUCCESS();
}
