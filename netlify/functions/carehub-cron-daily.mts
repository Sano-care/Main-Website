import type { Config } from "@netlify/functions";

// Daily trigger for CareHub outbound (Slice 5b). This function only PINGS the
// two CRON_SECRET-gated endpoints; ALL gating lives there:
//   - x-cron-secret must equal CRON_SECRET, AND
//   - each sweep sends NOTHING unless its WHATSAPP_CAREHUB_*_ENABLED === "true".
// So it can ship live and fire daily while sending nothing until you flip a flag.
export default async () => {
  const base = process.env.URL ?? process.env.DEPLOY_PRIME_URL; // Netlify-injected
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    console.error("carehub-cron-daily: missing URL or CRON_SECRET env");
    return new Response("misconfigured", { status: 500 });
  }
  for (const path of ["/api/cron/carehub-offer", "/api/cron/carehub-reminder"]) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "x-cron-secret": secret },
      });
      console.log(`carehub-cron-daily ${path} -> ${res.status}`);
    } catch (err) {
      console.error(`carehub-cron-daily ${path} failed`, err); // best-effort
    }
  }
  return new Response("ok");
};

export const config: Config = {
  schedule: "30 3 * * *", // 03:30 UTC = 09:00 IST, daily
};
