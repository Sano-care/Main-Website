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
// IMPORTANT REALITY (see PR description): the GTM container (GTM-T6K94WMC) is
// currently EMPTY and there is no GA4 / Meta Pixel / Google Ads ID wired in the
// app. So the conversion fires below are dormant until the founder creates those
// and sets GA4_MEASUREMENT_ID / META_PIXEL_ID / GOOGLE_ADS_CONVERSION (or
// configures the GTM container to act on the `whatsapp_click_paid` dataLayer
// event we always push). The redirect + server log work today regardless.
//
// Corrections vs the spec skeleton:
//   * Supabase (supabaseAdmin), not the non-existent `@/lib/db` `sql`.
//   * gtag/fbq are loaded HERE (route handlers don't inherit the root layout
//     where GTM lives), and every call is guarded so it can never block the
//     redirect.
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
  const cfg = safeJson({
    wa: waUrl,
    service,
    utm,
    ga4: process.env.GA4_MEASUREMENT_ID ?? null, // e.g. "G-XXXXXXX"
    pixel: process.env.META_PIXEL_ID ?? null, // e.g. "123456789012345"
    ads: process.env.GOOGLE_ADS_CONVERSION ?? null, // e.g. "AW-XXXXXXXXX/YYYYY"
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
    // Always push to dataLayer so a (later-configured) GTM container can fire tags.
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'whatsapp_click_paid', service: cfg.service,
      utm_source: cfg.utm.source, utm_medium: cfg.utm.medium, utm_campaign: cfg.utm.campaign,
      utm_content: cfg.utm.content, utm_term: cfg.utm.term });

    if (cfg.ga4) {
      var g = document.createElement('script'); g.async = true;
      g.src = 'https://www.googletagmanager.com/gtag/js?id=' + cfg.ga4;
      document.head.appendChild(g);
      function gtag(){ window.dataLayer.push(arguments); }
      window.gtag = window.gtag || gtag;
      gtag('js', new Date());
      gtag('config', cfg.ga4, { transport_type: 'beacon' });
      gtag('event', 'whatsapp_click', { service: cfg.service, transport_type: 'beacon',
        utm_source: cfg.utm.source, utm_medium: cfg.utm.medium, utm_campaign: cfg.utm.campaign,
        utm_content: cfg.utm.content, utm_term: cfg.utm.term });
      if (cfg.ads) gtag('event', 'conversion', { send_to: cfg.ads, transport_type: 'beacon' });
    }

    if (cfg.pixel) {
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
        n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
        (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', cfg.pixel);
      fbq('track', 'Lead', { content_name: cfg.service });
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
