"use client";

import { useEffect, useRef } from "react";

import {
  GCLID_COOKIE,
  WA_REF_COOKIE,
  readStored,
  writeStored,
} from "@/lib/wa/clientRef";

// Persist the Google Ads click id first-party, then mint the short WhatsApp ref
// token once. Mounted app-wide (root layout) so it runs on ANY inbound landing
// page, not just the homepage.
//
// Separation of concerns: PaidConversionFire fires the GA4/Ads *tags*; this
// component only captures + persists the click id and the ref token. They don't
// overlap, and neither depends on the other.
//
// Storage: `sc_gclid` (+ `sc_wa_ref`) as a first-party cookie (~90d, SameSite=Lax)
// with a localStorage mirror, so the token survives a cookie-less webview or a
// storage wipe on either side. Click ids are pseudonymous ad identifiers, not
// contact data — no PII is written here.

export function GclidCapture() {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    try {
      const q = new URLSearchParams(window.location.search);
      const gclid = q.get("gclid")?.trim() || null;
      const wbraid = (q.get("wbraid") || q.get("gbraid"))?.trim() || null;

      // (1) Persist whatever this landing carried. First click wins — a later
      // organic visit must not clobber the ad click that started the journey.
      if (gclid && !readStored(GCLID_COOKIE)) writeStored(GCLID_COOKIE, gclid);

      // (2) Mint the WhatsApp ref token once, for the stored click id.
      const storedGclid = gclid ?? readStored(GCLID_COOKIE);
      if (!storedGclid) return; // organic — leave WhatsApp links plain
      if (readStored(WA_REF_COOKIE)) return; // already minted

      void (async () => {
        try {
          const res = await fetch("/api/wa/click-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gclid: storedGclid, wbraid }),
          });
          if (!res.ok) return;
          const data = (await res.json()) as { token?: string | null };
          if (data?.token) writeStored(WA_REF_COOKIE, data.token);
        } catch {
          // Attribution is best-effort — never surface a failure to the visitor.
        }
      })();
    } catch {
      /* tracking must never break the page */
    }
  }, []);

  return null;
}
