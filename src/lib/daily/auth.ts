// Daily.co REST API auth + low-level request helper.
//
// Daily uses a static API key (Bearer token), not OAuth — much simpler
// than the Zoom S2S OAuth flow C2 had. One env var for the key, one for
// the team subdomain.
//
// The key is per-team and grants room-create + meeting-token-mint
// privileges. NEVER expose it to the client — every call goes through
// these helpers from a server route or server action.
//
// Env vars (set on Netlify before live testing — founder task #98):
//   DAILY_API_KEY  — secret, from Daily dashboard → Developers → API keys
//   DAILY_DOMAIN   — the Sanocare team subdomain (e.g. "sanocare"
//                    when the room URLs look like sanocare.daily.co/<room>)
//
// We do not currently consume DAILY_DOMAIN here — the full room URL
// comes back from Daily on room create and is stored on the doctor row,
// so the domain doesn't need to be reconstructed. The env var is kept
// in the contract for forward-compat (e.g. C3-V's webhook setup may
// need to register the domain explicitly).

const DAILY_API_BASE = "https://api.daily.co/v1";

export class DailyAuthError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "DailyAuthError";
  }
}

export class DailyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = "DailyApiError";
  }
}

/**
 * Daily-specific helper for "this room is already there" failures.
 * Daily returns HTTP 400 with body { error: "invalid-request-error",
 * info: "<message containing 'already exists'>" }. Useful for making
 * provisionDoctorDutyRoom idempotent — re-clicking the button after
 * the first success doesn't blow up.
 */
export function isDailyRoomAlreadyExists(err: unknown): err is DailyApiError {
  if (!(err instanceof DailyApiError)) return false;
  if (err.status !== 400) return false;
  const body = err.responseBody as { info?: string } | undefined;
  return typeof body?.info === "string" && /already exists/i.test(body.info);
}

/**
 * Daily-specific helper for "this room doesn't exist" — distinguishes
 * a real 404 from "Daily is down" so the ops UI can offer a "create"
 * fallback path.
 */
export function isDailyNotFound(err: unknown): err is DailyApiError {
  return err instanceof DailyApiError && err.status === 404;
}

interface DailyFetchOptions {
  method: "GET" | "POST" | "DELETE" | "PATCH";
  path: string;
  body?: unknown;
}

/**
 * Internal helper. All Daily REST calls go through here:
 *   - prepends DAILY_API_BASE
 *   - injects the Authorization Bearer header
 *   - throws typed errors on non-2xx
 *   - returns parsed JSON on success
 *
 * GET-with-no-body is supported by passing `body: undefined`.
 */
export async function dailyFetch<T>(opts: DailyFetchOptions): Promise<T> {
  const apiKey = requireEnv("DAILY_API_KEY");

  let response: Response;
  try {
    response = await fetch(`${DAILY_API_BASE}${opts.path}`, {
      method: opts.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (cause) {
    throw new DailyApiError(
      `Network error calling Daily (${opts.method} ${opts.path}).`,
      0,
      cause,
    );
  }

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as {
      error?: string;
      info?: string;
    };
    throw new DailyApiError(
      `Daily ${opts.method} ${opts.path} failed (HTTP ${response.status}): ${errBody.info ?? errBody.error ?? "no body"}`,
      response.status,
      errBody,
    );
  }

  return (await response.json()) as T;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new DailyAuthError(
      `Missing required env var: ${name}. Set it on Netlify before calling the Daily REST API.`,
    );
  }
  return v;
}
