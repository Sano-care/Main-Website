// Default-deny consent script — MUST execute before the GTM container's
// inline script loads, which is why it uses strategy="beforeInteractive".
// Without this, the first page-paint window between GTM-script-eval and
// our React rehydration would fire any tag inside the container with no
// consent gate at all.
//
// The script is intentionally inline (not a referenced .js file): it
// must be parsed and executed synchronously by the browser before GTM's
// own inline <script> hits the page. Next.js's Script component with
// strategy="beforeInteractive" places this in <head> before the body's
// hydration scripts.
//
// The wait_for_update: 500 setting tells GTM Consent Mode v2 to delay
// any tag-firing decision by up to 500ms while it waits for a
// gtag('consent','update',…). On a returning visitor that update fires
// almost instantly (inside this same inline script, by reading the
// sano_consent cookie). On a first-time visitor it never fires until the
// banner CTA is clicked — denied is the working default.
//
// Why inline + duplicated state-shape with consentState.ts:
//   - This file is read-once at page boot, before any module bundle.
//     It cannot import anything.
//   - consentState.ts is the React-side library used by the banner UI.
//     Both must agree on the cookie name and JSON shape, but they run
//     in different evaluation contexts.
//   - The inline copy is intentionally minimal — read cookie, push
//     consent updates if present, done. All UI logic stays in React.

import Script from "next/script";

import {
  CONSENT_COOKIE_NAME,
} from "./consentState";

/** Inline default-deny + cookie-hydration script body. */
const SCRIPT_BODY = `
(function () {
  window.dataLayer = window.dataLayer || [];
  function gtag(){window.dataLayer.push(arguments);}
  // 1. Default — everything tracking-adjacent is denied. functionality
  //    and security stay granted so essential cookies (auth, payment)
  //    still work.
  gtag('consent', 'default', {
    ad_storage: 'denied',
    analytics_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
    wait_for_update: 500
  });
  // 2. If the visitor has previously consented, restore that decision
  //    immediately so tags fire without the wait_for_update timeout
  //    hitting. Same cookie name + JSON shape as consentState.ts.
  try {
    var cookies = document.cookie ? document.cookie.split('; ') : [];
    var raw = null;
    for (var i = 0; i < cookies.length; i++) {
      var eq = cookies[i].indexOf('=');
      if (eq === -1) continue;
      if (cookies[i].slice(0, eq) === ${JSON.stringify(CONSENT_COOKIE_NAME)}) {
        raw = decodeURIComponent(cookies[i].slice(eq + 1));
        break;
      }
    }
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed.analytics === 'boolean' && typeof parsed.marketing === 'boolean') {
        gtag('consent', 'update', {
          ad_storage: parsed.marketing ? 'granted' : 'denied',
          analytics_storage: parsed.analytics ? 'granted' : 'denied',
          ad_user_data: parsed.marketing ? 'granted' : 'denied',
          ad_personalization: parsed.marketing ? 'granted' : 'denied'
        });
      }
    }
  } catch (e) {
    // If the cookie is malformed we leave the default-deny in place.
    // The banner UI will reprompt on render.
  }
})();
`;

export function ConsentDefaultScript() {
  return (
    <Script
      id="sano-consent-default"
      strategy="beforeInteractive"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: SCRIPT_BODY }}
    />
  );
}
