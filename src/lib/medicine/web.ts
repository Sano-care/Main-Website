// Web fallback — find the correct brand + composition for a medicine that the
// catalogue doesn't have.
//
// ⚠️ D2 IS UNRESOLVED. No drug-data source is wired yet: the brief explicitly
// says to surface source options and NOT hard-code an open-web scraper (ToS +
// accuracy risk). So this ships INERT behind WHATSAPP_MED_WEB_LOOKUP_ENABLED
// (default OFF) and returns { available: false }, which makes the resolver
// degrade gracefully to the strip-photo path. Once the founder picks a
// constrained/structured source (e.g. a licensed drug API), wire it inside
// performLookup and flip the flag.

export const MED_WEB_FLAG = "WHATSAPP_MED_WEB_LOOKUP_ENABLED";

export interface WebMedicineCandidate {
  available: boolean;
  proposed_brand?: string;
  composition?: string;
  source_url?: string;
  confidence?: number;
}

export function isMedWebLookupEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[MED_WEB_FLAG] === "true";
}

export interface WebLookupDeps {
  enabled?: boolean;
  /** Pluggable source — wired once D2 is settled. Default: none configured. */
  performLookup?: (query: string) => Promise<WebMedicineCandidate>;
}

export async function lookupMedicineWeb(
  query: string,
  deps: WebLookupDeps = {},
): Promise<WebMedicineCandidate> {
  const enabled = deps.enabled ?? isMedWebLookupEnabled();
  if (!enabled) return { available: false };
  const q = (query ?? "").trim();
  if (q.length < 2) return { available: false };
  // No source wired by default — see D2. A configured source is injected via
  // deps.performLookup (or wired here once chosen).
  if (!deps.performLookup) return { available: false };
  try {
    return await deps.performLookup(q);
  } catch (e) {
    console.error("[lookupMedicineWeb] source error:", e);
    return { available: false };
  }
}
