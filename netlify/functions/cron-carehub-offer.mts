import type { Config } from "@netlify/functions";

// Scheduled trigger — CareHub proactive offer sweep (Slice 5b). THIN: the route
// holds all logic (self-selects who's due + dedupes). SAFE to schedule now: the
// route sends NOTHING unless WHATSAPP_CAREHUB_OFFER_ENABLED === "true" (else it
// returns { ran:false } and audits carehub_skipped_flag_off). Daily trigger; the
// endpoint decides whether to act.
//
// Auth via the `x-cron-secret` header vs CRON_SECRET (route fails closed if unset).

const handler = async () => {
  const base = process.env.URL;
  if (!base) {
    console.error("[cron carehub-offer] URL env missing — skipping");
    return new Response(null, { status: 500 });
  }
  try {
    const res = await fetch(`${base}/api/cron/carehub-offer`, {
      method: "POST",
      headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
    });
    const body = await res.text();
    if (!res.ok) console.error("[cron carehub-offer] FAILED", res.status, body);
    else console.log("[cron carehub-offer] ok", res.status);
    return new Response(null, { status: res.ok ? 200 : 500 });
  } catch (err) {
    console.error("[cron carehub-offer] threw", err);
    return new Response(null, { status: 500 });
  }
};

export default handler;

// 10:00 IST daily (UTC+05:30) — business-hours; endpoint dedupes.
export const config: Config = { schedule: "30 4 * * *" };
