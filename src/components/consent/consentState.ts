// Cookie + client helpers for DPDP consent state.
//
// Two cookies are involved:
//
//   1. sano_consent — the consent decision itself.
//      Value: JSON {analytics: boolean, marketing: boolean, timestamp: ISO}
//      Lifetime: 1 year.
//      Read by the banner mount logic (to decide "show or suppress?") and
//      by the inline pre-GTM script (to call gtag('consent','update',…)
//      before any tag inside the GTM container has a chance to fire).
//
//   2. sano_anon_sid — a per-browser anonymous session UUID used by the
//      consent ledger to thread an anonymous visitor's consent events
//      together. Generated lazily on first consent action, stored for 1
//      year, never sent to GTM. Distinct from any logged-in customer
//      identity (sanocare_otp_verify), which is HttpOnly and resolved
//      server-side on the audit endpoint.
//
// All cookie writes use SameSite=Lax; Secure is added in production. None
// of these cookies are HttpOnly — they need to be readable by the inline
// gtag-consent-update script that runs before React hydrates.

export const CONSENT_COOKIE_NAME = "sano_consent";
export const ANON_SID_COOKIE_NAME = "sano_anon_sid";
export const CONSENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year
export const ANON_SID_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export type ConsentSource = "banner" | "preferences_modal" | "footer_link";

export interface ConsentState {
  analytics: boolean;
  marketing: boolean;
  /** ISO 8601 UTC timestamp of the decision. */
  timestamp: string;
}

/** Read the stored consent decision. Returns null if absent or malformed. */
export function readConsentCookie(): ConsentState | null {
  if (typeof document === "undefined") return null;
  const raw = readRawCookie(CONSENT_COOKIE_NAME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ConsentState>;
    if (
      typeof parsed.analytics !== "boolean" ||
      typeof parsed.marketing !== "boolean" ||
      typeof parsed.timestamp !== "string"
    ) {
      return null;
    }
    return {
      analytics: parsed.analytics,
      marketing: parsed.marketing,
      timestamp: parsed.timestamp,
    };
  } catch {
    return null;
  }
}

/** Persist the consent decision. */
export function writeConsentCookie(state: ConsentState): void {
  if (typeof document === "undefined") return;
  const value = encodeURIComponent(JSON.stringify(state));
  const secureFlag =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; Secure"
      : "";
  document.cookie = `${CONSENT_COOKIE_NAME}=${value}; path=/; max-age=${CONSENT_COOKIE_MAX_AGE}; SameSite=Lax${secureFlag}`;
}

/**
 * Return the existing anonymous-session UUID, or mint a fresh one and
 * persist it. Idempotent on subsequent calls in the same browser.
 */
export function ensureAnonSid(): string {
  if (typeof document === "undefined") return "";
  const existing = readRawCookie(ANON_SID_COOKIE_NAME);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const sid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : fallbackUuid();
  const secureFlag =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; Secure"
      : "";
  document.cookie = `${ANON_SID_COOKIE_NAME}=${sid}; path=/; max-age=${ANON_SID_COOKIE_MAX_AGE}; SameSite=Lax${secureFlag}`;
  return sid;
}

/** Push a gtag('consent','update',…) to the dataLayer. Safe no-op pre-hydration. */
export function updateGtagConsent(state: ConsentState): void {
  if (typeof window === "undefined") return;
  // dataLayer is created by the inline default-deny script that runs
  // strategy="beforeInteractive". Guard anyway — we never want a missing
  // dataLayer to crash a Save Preferences click.
  type DataLayerWindow = Window & { dataLayer?: unknown[] };
  const w = window as DataLayerWindow;
  if (!Array.isArray(w.dataLayer)) {
    w.dataLayer = [];
  }
  // gtag is a thin wrapper: dataLayer.push(arguments). Mirror the same
  // convention so GTM's Consent Mode v2 picks it up. The IArguments-style
  // object is what the official Google docs document — we replicate it as
  // an array because the standalone wrapper isn't available here.
  w.dataLayer.push([
    "consent",
    "update",
    {
      ad_storage: state.marketing ? "granted" : "denied",
      analytics_storage: state.analytics ? "granted" : "denied",
      ad_user_data: state.marketing ? "granted" : "denied",
      ad_personalization: state.marketing ? "granted" : "denied",
      // functionality + security stay 'granted' from the default script.
    },
  ]);
}

/** Fire-and-forget POST to the audit endpoint. */
export async function recordConsent(input: {
  state: ConsentState;
  source: ConsentSource;
  sessionId: string;
}): Promise<void> {
  try {
    await fetch("/api/consent/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        analytics: input.state.analytics,
        marketing: input.state.marketing,
        timestamp: input.state.timestamp,
        source: input.source,
        session_id: input.sessionId,
      }),
      keepalive: true,
    });
  } catch (err) {
    // Best-effort audit — don't block the UI flow if the network call fails.
    // The cookie write + gtag('consent','update') have already happened, so
    // the user's consent is honored locally; only the ledger row is missed.
    if (process.env.NODE_ENV === "development") {
      console.warn("[consent] audit POST failed (best-effort):", err);
    }
  }
}

/** Build a fresh ConsentState with the current ISO timestamp. */
export function buildConsent(analytics: boolean, marketing: boolean): ConsentState {
  return { analytics, marketing, timestamp: new Date().toISOString() };
}

// ===== internals =====

function readRawCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const cookies = document.cookie ? document.cookie.split("; ") : [];
  for (const c of cookies) {
    const eq = c.indexOf("=");
    if (eq === -1) continue;
    const key = c.slice(0, eq);
    if (key === name) {
      const raw = c.slice(eq + 1);
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

function fallbackUuid(): string {
  // Only used in environments without crypto.randomUUID; near-impossible
  // on modern browsers but kept for defence in depth. Not cryptographically
  // strong — fine for session correlation, never used as a secret.
  const r = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `${r()}${r()}-${r()}-${r()}-${r()}-${r()}${r()}${r()}`;
}
