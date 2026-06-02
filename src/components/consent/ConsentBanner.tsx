"use client";

import Link from "next/link";

interface ConsentBannerProps {
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onManagePreferences: () => void;
}

export function ConsentBanner({
  onAcceptAll,
  onRejectAll,
  onManagePreferences,
}: ConsentBannerProps) {
  return (
    <div
      role="dialog"
      aria-labelledby="sano-consent-banner-title"
      aria-describedby="sano-consent-banner-desc"
      className="fixed bottom-0 inset-x-0 z-[100] px-4 pb-4 sm:px-6 sm:pb-6 pointer-events-none"
    >
      <div className="mx-auto max-w-2xl bg-white border border-slate-200 shadow-2xl rounded-2xl p-5 pointer-events-auto">
        <h2 id="sano-consent-banner-title" className="sr-only">
          Cookie consent
        </h2>
        <p
          id="sano-consent-banner-desc"
          className="text-sm text-slate-700 leading-relaxed"
        >
          We use cookies to make Sanocare work better for you. Some are
          essential to keep the site running. Others help us understand how
          you use the service so we can improve it. You decide which ones
          we use.
        </p>

        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2">
          <button
            type="button"
            onClick={onRejectAll}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-50 rounded-lg border border-slate-200"
          >
            Reject all
          </button>
          <button
            type="button"
            onClick={onManagePreferences}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-50 rounded-lg border border-slate-200"
          >
            Manage preferences
          </button>
          <button
            type="button"
            onClick={onAcceptAll}
            className="px-4 py-2 text-sm font-medium bg-sky-600 hover:bg-sky-700 text-white rounded-lg"
          >
            Accept all
          </button>
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Read our{" "}
          <Link
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-slate-700"
          >
            privacy policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
