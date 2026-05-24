// Zoom Server-to-Server OAuth token manager.
//
// One Sanocare server, one Zoom account, no per-user OAuth. The S2S
// account_credentials grant returns a bearer token good for 1 hour;
// when expired we mint a fresh one — there is no refresh-token flow
// for S2S.
//
// In-memory cache with a 60-second safety buffer so concurrent callers
// in the same Node process share a single token. Survives a request
// lifetime; resets on cold start. That's fine — minting a fresh token
// is one POST, costs nothing.
//
// Env vars (set on Netlify):
//   ZOOM_ACCOUNT_ID    — account id from the Zoom Marketplace app
//   ZOOM_CLIENT_ID     — S2S OAuth app client id
//   ZOOM_CLIENT_SECRET — S2S OAuth app client secret
//
// Token endpoint, grant type, response shape are documented in the
// bundled zoom-plugin:rest-api skill (concepts/authentication-flows.md).
// Anything that changes upstream (rare) we update there.

const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token";

// Granular scope strings the founder must add to the Marketplace S2S app
// (these are what the access_token's `scope` claim will carry). Kept
// here as code-readable documentation; we don't enforce that the
// returned scope contains each entry, because Zoom can lazily promote
// scope names and our build shouldn't fight that.
export const ZOOM_REQUIRED_SCOPES_C2 = [
  "user:read:user:admin",     // GET /users/{userId}
  "user:read:settings:admin", // GET /users/{userId}/settings
] as const;
export const ZOOM_REQUIRED_SCOPES_C3_FORWARD_COMPAT = [
  "meeting:read:meeting:admin",
  "meeting:read:participant:admin",
  "recording:read:recording:admin",
] as const;

interface ZoomTokenResponse {
  access_token: string;
  token_type: string; // always "bearer"
  expires_in: number; // seconds; Zoom returns 3600
  scope: string;      // space-separated granted scopes
  api_url?: string;   // regional base URL hint (default https://api.zoom.us)
}

export class ZoomAuthError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ZoomAuthError";
  }
}

let cachedToken: string | null = null;
let cachedTokenExpiry = 0; // unix ms

/**
 * Returns a valid Zoom S2S bearer token. Caches in-process for the
 * full TTL minus a 60-second safety buffer.
 */
export async function getZoomAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedTokenExpiry - 60_000) {
    return cachedToken;
  }

  const accountId = requireEnv("ZOOM_ACCOUNT_ID");
  const clientId = requireEnv("ZOOM_CLIENT_ID");
  const clientSecret = requireEnv("ZOOM_CLIENT_SECRET");

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  let response: Response;
  try {
    response = await fetch(ZOOM_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: `grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    });
  } catch (cause) {
    throw new ZoomAuthError("Network error reaching Zoom token endpoint.", cause);
  }

  const json = (await response.json().catch(() => ({}))) as Partial<ZoomTokenResponse> & {
    reason?: string;
    error?: string;
  };

  if (!response.ok || !json.access_token) {
    throw new ZoomAuthError(
      `Zoom token mint failed (HTTP ${response.status}): ${json.error ?? json.reason ?? "unknown"}`,
      json,
    );
  }

  cachedToken = json.access_token;
  // Zoom's expires_in is in seconds. Re-cache the wall-clock expiry.
  cachedTokenExpiry = Date.now() + (json.expires_in ?? 3600) * 1000;
  return cachedToken;
}

/**
 * Forget the cached token. Used by tests and by error paths that suspect
 * the cached token has been revoked upstream (rare).
 */
export function resetZoomAuthCache(): void {
  cachedToken = null;
  cachedTokenExpiry = 0;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new ZoomAuthError(
      `Missing required env var: ${name}. Set it on Netlify before calling the Zoom REST API.`,
    );
  }
  return v;
}
