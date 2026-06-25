import type { Config } from "@netlify/functions";

// Scheduled trigger — purge of expired ops/chat media (#103). THIN: it only
// calls the canonical route, which holds all logic (delete media_assets +
// objects whose purge_after < now()). No business logic here.
//
// Auth: the route's checkCronSecret() compares the `x-cron-secret` header to the
// CRON_SECRET env var (fails closed if unset). Base URL = process.env.URL
// (Netlify-provided). Flagless → starts enforcing 3-day retention immediately.

const handler = async () => {
  const base = process.env.URL;
  if (!base) {
    console.error("[cron ops-media-purge] URL env missing — skipping");
    return new Response(null, { status: 500 });
  }
  try {
    const res = await fetch(`${base}/api/cron/ops-media-purge`, {
      method: "POST",
      headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
    });
    const body = await res.text();
    if (!res.ok) console.error("[cron ops-media-purge] FAILED", res.status, body);
    else console.log("[cron ops-media-purge] ok", res.status);
    return new Response(null, { status: res.ok ? 200 : 500 });
  } catch (err) {
    console.error("[cron ops-media-purge] threw", err);
    return new Response(null, { status: 500 });
  }
};

export default handler;

// 02:00 IST daily (UTC+05:30) — off-peak purge of media older than its TTL.
export const config: Config = { schedule: "30 20 * * *" };
