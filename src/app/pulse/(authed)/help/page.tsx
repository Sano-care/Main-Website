import Link from "next/link";
import { Mail, MessageCircle, Phone } from "lucide-react";

import {
  PHONE_DISPLAY,
  PHONE_TEL,
  SUPPORT_EMAIL,
  WHATSAPP_DEEPLINK,
} from "@/lib/contact";

/**
 * T90 Slice 2 Step 15 — Help & support stub (/pulse/help).
 *
 * Pure static surface. Three primary contact rows (WhatsApp / call /
 * email) + hours-of-operation + soft links to privacy + terms.
 *
 * All links are plain <a href> / <Link href> — no client interactivity,
 * so the entire page renders server-side.
 *
 * Phone number, WhatsApp deeplink, and support email are sourced from
 * src/lib/contact.ts (introduced this commit) — single source of truth.
 *
 * Hours-of-operation: locked to "8 AM – 10 PM IST, every day" per
 * founder Step 15 plan-gate confirmation.
 */

export const dynamic = "force-static";

export default function PulseHelpPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-24 pt-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-text-main">
          Help &amp; support
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Available 8 AM – 10 PM IST, every day. We typically respond within
          a few minutes during these hours.
        </p>
      </header>

      {/* === Contact channels =================================== */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <a
          href={WHATSAPP_DEEPLINK}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Chat with Sanocare on WhatsApp at ${PHONE_DISPLAY}`}
          className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-slate-50"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-whatsapp)]/10 text-[color:var(--color-whatsapp)]">
            <MessageCircle className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text-main">
              Chat on WhatsApp
            </p>
            <p className="mt-0.5 text-xs text-text-secondary">
              Quickest way to reach us
            </p>
          </div>
          <span aria-hidden="true" className="text-text-secondary">
            →
          </span>
        </a>

        <div className="h-px bg-slate-100" />

        <a
          href={`tel:${PHONE_TEL}`}
          aria-label={`Call Sanocare at ${PHONE_DISPLAY}`}
          className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-slate-50"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-accent-coral)]/12 text-[color:var(--color-accent-coral-dark)]">
            <Phone className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text-main">
              Call us
            </p>
            <p className="mt-0.5 text-xs text-text-secondary">
              {PHONE_DISPLAY}
            </p>
          </div>
          <span aria-hidden="true" className="text-text-secondary">
            →
          </span>
        </a>

        <div className="h-px bg-slate-100" />

        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          aria-label={`Email Sanocare at ${SUPPORT_EMAIL}`}
          className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-slate-50"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary">
            <Mail className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text-main">
              Email
            </p>
            <p className="mt-0.5 truncate text-xs text-text-secondary">
              {SUPPORT_EMAIL}
            </p>
          </div>
          <span aria-hidden="true" className="text-text-secondary">
            →
          </span>
        </a>
      </section>

      {/* === Policy links — soft, footer-style =================== */}
      <section className="px-1 pt-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
          Policies
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link
            href="/privacy"
            className="text-primary hover:underline"
          >
            Privacy policy
          </Link>
          <Link
            href="/terms"
            className="text-primary hover:underline"
          >
            Terms of service
          </Link>
          <Link
            href="/refund"
            className="text-primary hover:underline"
          >
            Refund policy
          </Link>
        </div>
      </section>
    </div>
  );
}
