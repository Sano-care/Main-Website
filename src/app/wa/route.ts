// GET /wa — the single paid-conversion redirect endpoint.
//
// Final URL for every paid ad (Google Ads now; Meta CTWA / LinkedIn later).
// On each hit it: (1) server-side logs the click to paid_click_log (cookieless,
// DPDP-safe attribution source of truth), then (2) returns a thin HTML page that
// fires the conversion events and (3) redirects to wa.me with a service-specific
// pre-fill.
//
// Why a 200 HTML page and not a 302: a pure redirect can't run client-side
// tracking. This page fires the events then JS-redirects after a short delay
// (invisible). A <meta refresh> + <noscript> backstop guarantee the redirect
// even if JS errors or is disabled — the user is NEVER stranded.
//
// ANALYTICS POSTURE (founder decision 2026-06-05): GA4 + Google Ads fire here
// directly under Consent Mode v2 default-deny (cookieless modelling pings). The
// Meta Pixel is NOT fired here — it runs via a consent-gated GTM tag, so it
// never sets cookies pre-consent (healthcare DPDP). GA4_MEASUREMENT_ID defaults
// to the live property; GOOGLE_ADS_CONVERSION is set once the Ads conversion
// action exists. The redirect + server log work regardless of any of this.
//
// Corrections vs the spec skeleton:
//   * Supabase (supabaseAdmin), not the non-existent `@/lib/db` `sql`.
//   * gtag is loaded + consent-defaulted HERE (route handlers don't inherit the
//     root layout/Consent script), every call guarded so tracking can never
//     block the redirect; the Pixel is routed via consent-gated GTM, not direct.
//   * DB insert runs via after() so it can't be dropped as an un-awaited
//     promise, without blocking TTFB.
//   * UTM values are attacker-controllable — they are JSON-encoded and
//     <-escaped before going into the inline <script>, closing an XSS hole.

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SANOCARE_WA = "919711977782";

// service slug -> WhatsApp pre-fill. other / invalid / missing all collapse to
// the generic message (per founder's latest mapping).
const SERVICE_MESSAGES: Record<string, string> = {
  home_visit: "Hi Sanocare, I'm interested in Home Visit + Doctor Consult",
  nursing: "Hi Sanocare, I need Home Nursing care",
  lab: "Hi Sanocare, I want to book a Lab Test at Home",
  teleconsult: "Hi Sanocare, I want a Teleconsultation with a doctor",
  other: "Hi Sanocare, I have a question about your services",
};

function normalizeService(raw: string | null): string {
  return raw && SERVICE_MESSAGES[raw] ? raw : "other";
}

function hashIp(ip: string | null): string | null {
  const salt = process.env.IP_SALT;
  if (!ip || !salt) return null; // never store a raw or weakly-salted IP
  return createHash("sha256").update(ip + salt).digest("hex");
}

function clientIp(req: NextRequest): string | null {
  // Netlify sets x-nf-client-connection-ip; fall back to the first XFF hop.
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

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const service = normalizeService(params.get("service"));
  const message = SERVICE_MESSAGES[service];
  const waUrl = `https://wa.me/${SANOCARE_WA}?text=${encodeURIComponent(message)}`;

  const utm = {
    source: params.get("utm_source"),
    medium: params.get("utm_medium"),
    campaign: params.get("utm_campaign"),
    content: params.get("utm_content"),
    term: params.get("utm_term"),
  };

  // (1) Server-side log — non-blocking via after(), so it neither delays TTFB
  // nor gets dropped as an un-awaited promise.
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

  // (2) Config the inline script reads — XSS-safe (UTMs are user input).
  // GA4 + Google Ads fire DIRECTLY here under Consent Mode (cookieless). Meta
  // Pixel is intentionally NOT fired here — it runs via the consent-gated GTM
  // tag off the whatsapp_click_paid dataLayer event (DPDP: Consent Mode v2,
  // founder decision). The GTM container is NOT loaded on /wa on purpose: doing
  // so would double-fire the Ads conversion (GTM tag + direct fire) and corrupt
  // Smart Bidding. The independent backup is the server-side paid_click_log.
  const cfg = safeJson({
    wa: waUrl,
    service,
    utm,
    ga4: process.env.GA4_MEASUREMENT_ID ?? "G-VSP31JFVVJ", // public id; env overrides
    ads: process.env.GOOGLE_ADS_CONVERSION ?? null, // AW-.../label — set when ready
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
    // Consent Mode v2 default-deny: GA4 + Ads send COOKIELESS modelling pings
    // until the user consents elsewhere. Healthcare DPDP posture (founder call).
    gtag('consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied',
      ad_user_data: 'denied', ad_personalization: 'denied' });
    // Event for the consent-gated GTM tags (incl. the Meta Pixel, which is NOT
    // fired directly here). GTM is not loaded on /wa, so this is a no-op on this
    // page today; it is the integration point if a GTM Pixel tag is ever loaded.
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
      if (cfg.ads) gtag('event', 'conversion', { send_to: cfg.ads, transport_type: 'beacon' });
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
