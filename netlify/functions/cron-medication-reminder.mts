import type { Config } from "@netlify/functions";

// Scheduled trigger — Aarogya medication-reminder sweep. THIN: the route holds
// all logic (self-selects doses due in the current 15-min IST window + dedupes
// via medication_reminder_log's UNIQUE). SAFE to schedule now: sends NOTHING
// unless WHATSAPP_MEDICATION_REMINDER_ENABLED === "true".
//
// Auth via the `x-cron-secret` header vs CRON_SECRET (route fails closed if unset).

const handler = async () => {
  const base = process.env.URL;
  if (!base) {
    console.error("[cron medication-reminder] URL env missing — skipping");
    return new Response(null, { status: 500 });
  }
  try {
    const res = await fetch(`${base}/api/cron/medication-reminder`, {
      method: "POST",
      headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
    });
    const body = await res.text();
    if (!res.ok) console.error("[cron medication-reminder] FAILED", res.status, body);
    else console.log("[cron medication-reminder] ok", res.status);
    return new Response(null, { status: res.ok ? 200 : 500 });
  } catch (err) {
    console.error("[cron medication-reminder] threw", err);
    return new Response(null, { status: 500 });
  }
};

export default handler;

// Every 15 minutes — a dose at IST time T fires when now ∈ [T, T+15min).
export const config: Config = { schedule: "*/15 * * * *" };
