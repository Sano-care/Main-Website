"use client";

import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { useCallback } from "react";
import { Phone } from "lucide-react";

import { PHONE_DISPLAY, PHONE_TEL } from "@/lib/contact";
import { buildDataLayerPayload, buildWaUrl } from "./talkUtils";

// @next/third-parties globally declares window.dataLayer as `Object[]` — we
// inherit that typedef and push our typed payload onto it. The upstream type
// is intentionally permissive; the payload SHAPE is locked at the call site
// via buildDataLayerPayload.

/**
 * Hero CTA for /talk. Lives in a client component because the WhatsApp URL +
 * dataLayer payload both pull live UTM/msg query params via useSearchParams.
 *
 * The button itself is a real anchor (`<a href={...}>`) so it works at the OS
 * level — long-press to copy, accessible to screen readers, no JS required to
 * reach WhatsApp. The onClick is purely additive: fires the conversion event
 * for GTM/Google Ads BEFORE the navigation happens. If JS is disabled, the
 * page still works as a static link — the conversion just won't be recorded.
 */
export function TalkClient() {
  const searchParams = useSearchParams();

  // Resolve the live href on every render. URL is built from query params
  // so the link surface (Cmd+click, hover preview, accessibility tree) always
  // reflects what'll be opened. searchParams is stable across renders so we
  // can recompute cheaply.
  const msgParam = searchParams.get("msg");
  const waHref = buildWaUrl(msgParam);

  const handleClick = useCallback(() => {
    if (typeof window === "undefined") return;
    window.dataLayer = window.dataLayer ?? [];
    window.dataLayer.push(
      buildDataLayerPayload({
        utm_source: searchParams.get("utm_source"),
        utm_medium: searchParams.get("utm_medium"),
        utm_campaign: searchParams.get("utm_campaign"),
        utm_term: searchParams.get("utm_term"),
        utm_content: searchParams.get("utm_content"),
        gclid: searchParams.get("gclid"),
      }),
    );
    // Don't preventDefault — the anchor's normal navigation does the work.
  }, [searchParams]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-6 py-12">
      <div className="flex w-full max-w-[540px] flex-col items-center text-center">
        <Image
          src="/sanocare-lockup.svg"
          alt="Sanocare"
          width={180}
          height={36}
          priority
          className="mb-10 h-auto w-[180px]"
        />

        <h1 className="font-sans text-[28px] font-semibold leading-tight text-slate-900 sm:text-[32px]">
          Talk to Sanocare on WhatsApp
        </h1>

        <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
          Reply in under 2 minutes. Care at your doorstep
          <br className="hidden sm:inline" /> across Delhi NCR.
        </p>

        <a
          href={waHref}
          onClick={handleClick}
          rel="noopener"
          className="mt-10 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-6 text-base font-semibold text-white shadow-sm transition active:translate-y-px hover:bg-[#1FB658] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#25D366]"
          data-testid="talk-wa-cta"
        >
          <span aria-hidden="true" className="text-xl">💬</span>
          <span>Open WhatsApp</span>
        </a>

        <div className="mt-8 flex w-full items-center gap-3 text-xs uppercase tracking-wider text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          <span>or call</span>
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        <a
          href={`tel:${PHONE_TEL}`}
          className="mt-4 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-base font-medium text-slate-700 transition hover:text-[#2B81FF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2B81FF]"
        >
          <Phone size={18} aria-hidden="true" />
          {PHONE_DISPLAY}
        </a>

        <div className="mt-12 h-px w-24 bg-slate-200" />

        <p className="mt-6 text-sm text-slate-500">
          Sanocare Tech Innovations Pvt. Ltd.
        </p>
        <p className="text-sm text-slate-500">
          1666/B2, Kalkaji, New Delhi
        </p>
      </div>
    </main>
  );
}
