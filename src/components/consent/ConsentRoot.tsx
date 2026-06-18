"use client";

// Root mount for the DPDP cookie consent flow. Lives inside <body> in
// the global layout so it covers every route, but its render output is
// route-aware: auto-show banner is suppressed on authenticated /
// tokened surfaces where the cookie consent is contextually
// inappropriate (the patient already booked → they consented in some
// form; doctor / ops surfaces are not marketing).
//
// Footer link integration:
//   The global Footer renders a "Manage cookies" button that fires a
//   window event 'sano:openConsent'. ConsentRoot listens for it and
//   opens the PreferencesModal regardless of suppression — so users on
//   marketing pages can always opt in / out, but auto-prompt only
//   triggers on surfaces where the banner makes contextual sense.
//
// The Footer is mounted only on marketing surfaces (home, about,
// services, lab-tests, sanopulse, research, contact, now, carehub,
// blog/[slug], LegalLayout) — exactly matching the surface set where
// auto-show is allowed. So the "footer link doesn't render on
// suppressed routes" is correct by construction; the route never had
// the footer link in the first place. ConsentRoot itself mounts
// globally so the listener is always armed if a user navigates from
// a marketing surface into an authenticated surface mid-session.

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { ConsentBanner } from "./ConsentBanner";
import { PreferencesModal } from "./PreferencesModal";
import {
  buildConsent,
  ensureAnonSid,
  readConsentCookie,
  recordConsent,
  updateGtagConsent,
  writeConsentCookie,
  type ConsentSource,
  type ConsentState,
} from "./consentState";

/**
 * Route prefixes where the auto-show banner is suppressed. The footer
 * "Manage cookies" link still works on any page that mounts the
 * Footer, but those Footer-mounting surfaces are marketing-only by
 * construction.
 *
 * Matched by `pathname === prefix || pathname.startsWith(prefix + "/")`
 * — NOT a plain `startsWith(prefix)`. Plain startsWith would
 * false-positive on marketing routes that legitimately begin with a
 * suppressed prefix's characters (e.g. /carehub, /contact would both
 * match a bare "/c" prefix; /doctors would match "/doctor"). The
 * boundary-aware matcher catches the bare suppressed root (/ops, /c,
 * /rx, /portal, /doctor) AND any /prefix/* sub-path, while leaving
 * /carehub and friends untouched.
 */
const SUPPRESSED_PREFIXES = ["/c", "/doctor", "/ops", "/rx", "/portal", "/talk"];

function isSuppressedPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return SUPPRESSED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

/** Window event name dispatched by the Footer "Manage cookies" button. */
export const OPEN_CONSENT_EVENT = "sano:openConsent";

export function ConsentRoot() {
  const pathname = usePathname();
  // Banner visibility — null while we haven't read the cookie yet
  // (avoids a flash-of-banner on returning visitors).
  const [shouldShowBanner, setShouldShowBanner] = useState<boolean | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [currentConsent, setCurrentConsent] = useState<ConsentState | null>(null);

  // Decide on mount whether the auto-show banner is allowed for this
  // route and whether the visitor has already consented.
  useEffect(() => {
    const stored = readConsentCookie();
    setCurrentConsent(stored);

    if (stored) {
      // Already consented — don't auto-show, but keep the listener for
      // the footer-link reopen path.
      setShouldShowBanner(false);
      return;
    }

    setShouldShowBanner(!isSuppressedPath(pathname));
  }, [pathname]);

  // Footer-link reopen path.
  useEffect(() => {
    const handler = () => setModalOpen(true);
    window.addEventListener(OPEN_CONSENT_EVENT, handler);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, handler);
  }, []);

  const persist = useCallback(
    (analytics: boolean, marketing: boolean, source: ConsentSource) => {
      const state = buildConsent(analytics, marketing);
      writeConsentCookie(state);
      updateGtagConsent(state);
      const sid = ensureAnonSid();
      // Fire-and-forget; recordConsent never throws.
      void recordConsent({ state, source, sessionId: sid });
      setCurrentConsent(state);
      setShouldShowBanner(false);
      setModalOpen(false);
    },
    [],
  );

  const handleAcceptAll = useCallback(() => {
    persist(true, true, "banner");
  }, [persist]);

  const handleRejectAll = useCallback(() => {
    persist(false, false, "banner");
  }, [persist]);

  const handleManagePreferences = useCallback(() => {
    setModalOpen(true);
  }, []);

  const handleModalCancel = useCallback(() => {
    setModalOpen(false);
  }, []);

  const handleModalSave = useCallback(
    ({ analytics, marketing }: { analytics: boolean; marketing: boolean }) => {
      // If the modal is open because the visitor never consented yet
      // (no cookie) — source is preferences_modal. If they reopened it
      // via the footer link (cookie exists already) — source is
      // footer_link.
      const source: ConsentSource = currentConsent
        ? "footer_link"
        : "preferences_modal";
      persist(analytics, marketing, source);
    },
    [currentConsent, persist],
  );

  // shouldShowBanner is null until the cookie read completes; render
  // nothing in that window to avoid SSR/hydration banner flicker.
  return (
    <>
      {shouldShowBanner && (
        <ConsentBanner
          onAcceptAll={handleAcceptAll}
          onRejectAll={handleRejectAll}
          onManagePreferences={handleManagePreferences}
        />
      )}
      <PreferencesModal
        open={modalOpen}
        current={currentConsent}
        onCancel={handleModalCancel}
        onSave={handleModalSave}
      />
    </>
  );
}
