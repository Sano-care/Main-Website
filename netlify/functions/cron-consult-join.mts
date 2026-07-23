import type { Config } from "@netlify/functions";

// PB4a — scheduled trigger for the teleconsult join-link sweep. THIN: the route
// holds all logic (selects sessions ~10 min from scheduled_at with
// join_link_sent_at IS NULL, claim-then-send, stamps the marker). SAFE to
// schedule now: sends NOTHING unless WHATSAPP_CONSULT_ENABLED === "true".
//
// Auth via the `x-cron-secret` header vs CRON_SECRET (route fails closed if unset).

const handler = async () => {
  const base = process.env.URL;
  if (!base) {
    console.error("[cron consult-join] URL env missing — skipping");
    return new Response(null, { status: 500 });
  }
  try {
    const res = await fetch(`${base}/api/cron/consult-join`, {
      method: "POST",
      headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
    });
    const body = await res.text();
    if (!res.ok) console.error("[cron consult-join] FAILED", res.status, body);
    else console.log("[cron consult-join] ok", res.status);
    return new Response(null, { status: res.ok ? 200 : 500 });
  } catch (err) {
    console.error("[cron consult-join] threw", err);
    return new Response(null, { status: 500 });
  }
};

export default handler;

// Every 5 minutes — a slot at IST time T gets its join link ~10 min prior.
export const config: Config = { schedule: "*/5 * * * *" };
