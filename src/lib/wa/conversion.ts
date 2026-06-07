// Shared paid-conversion handler behind /wa AND the /book-* campaign aliases.
//
// It server-logs the click to paid_click_log (cookieless, DPDP-safe), then
// returns a thin 200 HTML page that fires the GA4/Ads conversion (Consent Mode
// default-deny → cookieless modelling pings; Meta Pixel routed via consent-gated
// GTM, not here) and redirects to wa.me with a service-specific pre-fill.
//
// serviceOverride lets the /book-* alias routes hard-set the service (e.g.
// home_visit) WITHOUT relying on a rewrite carrying ?service= — Next-on-Netlify
// drops a rewrite destination's static query, which silently fell back to the
// generic "other" message. Alias routes call this directly, so the service is
// guaranteed and the incoming UTM params still flow through via searchParams.
//
// See the prior /wa skeleton corrections: supabaseAdmin (not @/lib/db); gtag
// loaded + consent-defaulted here; insert via after(); UTMs JSON+<-escaped (XSS).

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";

const SANOCARE_WA = "919711977782";

// service slug -> WhatsApp pre-fill. other / invalid / missing collapse to the
// generic message.
const SERVICE_MESSAGES: Record<string, string> = {
  home_visit: "Hi Sanocare, I'm interested in Home Visit + Doctor Consult",
  nursing: "Hi Sanocare, I need Home Nursing care",
  lab: "Hi Sanocare, I want to book a Lab Test at Home",
  teleconsult: "Hi Sanocare, I want a Teleconsultation with a doctor",
  other: "Hi Sanocare, I have a question about your services",
};

function normalizeService(raw: string | null | undefined): string {
  return raw && SERVICE_MESSAGES[raw] ? raw : "other";
}

function hashIp(ip: string | null): string | null {
  const salt = process.env.IP_SALT;
  if (!ip || !salt) return null; // never store a raw or weakly-salted IP
  return createHash("sha256").update(ip + salt).digest("hex");
}

function clientIp(req: NextRequest): string | null {
  return (
    req.headers.get("x-nf-client-connection-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

// Escape a JSON string so it is safe to embed inside an inline <script>.
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Build the /wa conversion response. If serviceOverride is given (alias routes),
 * it wins over ?service=; otherwise the service comes from the query.
 */
export async function buildWaResponse(
  req: NextRequest,
  serviceOverride?: string,
): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const service = normalizeService(serviceOverride ?? params.get("service"));
  const message = SERVICE_MESSAGES[service];
  const waUrl = `https://wa.me/${SANOCARE_WA}?text=${encodeURIComponent(message)}`;

  const utm = {
    source: params.get("utm_source"),
    medium: params.get("utm_medium"),
    campaign: params.get("utm_campaign"),
    content: params.get("utm_content"),
    term: params.get("utm_term"),
  };

  // (1) Server-side log — non-blocking via after().
  const ipHash = hashIp(clientIp(req));
  const referrer = req.headers.get("referer");
  const userAgent = req.headers.get("user-agent");
  after(async () => {
    try {
      const { error } = await supabaseAdmin.from("paid_click_log").insert({
        service,
        utm_source: utm.source,
        utm_medium: utm.medium,
        utm_campaign: utm.campaign,
        utm_content: utm.content,
        utm_term: utm.term,
        referrer,
        user_agent: userAgent,
        ip_hash: ipHash,
      });
      if (error) console.error("[wa] paid_click_log insert failed:", error.message);
    } catch (err) {
      console.error("[wa] paid_click_log insert threw:", err);
    }
  });

  // (2) XSS-safe config for the inline tracking script.
  const cfg = safeJson({
    wa: waUrl,
    service,
    utm,
    ga4: process.env.GA4_MEASUREMENT_ID ?? "G-VSP31JFVVJ", // public id; env overrides
    ads: process.env.GOOGLE_ADS_CONVERSION ?? "AW-18031024663/lDyRCNb0sLocEJe07pVD", // public Ads send_to; env overrides
  });

  const waAttr = escapeAttr(waUrl);

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connecting to Sanocare…</title>
<meta http-equiv="refresh" content="2;url=${waAttr}">
<script>
(function(){
  var cfg = ${cfg};
  function go(){ try { window.location.replace(cfg.wa); } catch(e){ window.location.href = cfg.wa; } }
  try {
    window.dataLayer = window.dataLayer || [];
    function gtag(){ window.dataLayer.push(arguments); }
    window.gtag = window.gtag || gtag;
    // Consent Mode v2 default-deny: GA4 + Ads send COOKIELESS modelling pings.
    gtag('consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied',
      ad_user_data: 'denied', ad_personalization: 'denied' });
    window.dataLayer.push({ event: 'whatsapp_click_paid', service: cfg.service,
      utm_source: cfg.utm.source, utm_medium: cfg.utm.medium, utm_campaign: cfg.utm.campaign,
      utm_content: cfg.utm.content, utm_term: cfg.utm.term });

    if (cfg.ga4) {
      var g = document.createElement('script'); g.async = true;
      g.src = 'https://www.googletagmanager.com/gtag/js?id=' + cfg.ga4;
      document.head.appendChild(g);
      gtag('js', new Date());
      gtag('config', cfg.ga4, { transport_type: 'beacon' });
      gtag('event', 'whatsapp_click', { service: cfg.service, transport_type: 'beacon',
        utm_source: cfg.utm.source, utm_medium: cfg.utm.medium, utm_campaign: cfg.utm.campaign,
        utm_content: cfg.utm.content, utm_term: cfg.utm.term });
      if (cfg.ads) gtag('event', 'conversion', { send_to: cfg.ads, value: 500.0, currency: 'INR', transport_type: 'beacon' });
    }
  } catch (e) { /* tracking must never block the redirect */ }
  setTimeout(go, 150);
})();
</script>
</head><body style="margin:0;font-family:system-ui,-apple-system,sans-serif">
<noscript><meta http-equiv="refresh" content="0;url=${waAttr}"></noscript>
<p style="text-align:center;padding:48px 24px;color:#64748B">Connecting you to Sanocare on WhatsApp…</p>
</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
