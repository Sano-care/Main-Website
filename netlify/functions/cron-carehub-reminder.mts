import type { Config } from "@netlify/functions";

// Scheduled trigger — CareHub monthly home-visit reminder sweep (Slice 5b). THIN:
// the route holds all logic (the daily run self-selects who is due their monthly
// reminder + dedupes: skips already-sent / visit-already-booked). SAFE to schedule
// now: sends NOTHING unless WHATSAPP_CAREHUB_VISIT_REMINDER_ENABLED === "true".
//
// Auth via the `x-cron-secret` header vs CRON_SECRET (route fails closed if unset).

const handler = async () => {
  const base = process.env.URL;
  if (!base) {
    console.error("[cron carehub-reminder] URL env missing — skipping");
    return new Response(null, { status: 500 });
  }
  try {
    const res = await fetch(`${base}/api/cron/carehub-reminder`, {
      method: "POST",
      headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
    });
    const body = await res.text();
    if (!res.ok) console.error("[cron carehub-reminder] FAILED", res.status, body);
    else console.log("[cron carehub-reminder] ok", res.status);
    return new Response(null, { status: res.ok ? 200 : 500 });
  } catch (err) {
    console.error("[cron carehub-reminder] threw", err);
    return new Response(null, { status: 500 });
  }
};

export default handler;

// 10:30 IST daily (UTC+05:30) — daily run picks who's due the monthly reminder.
export const config: Config = { schedule: "0 5 * * *" };
