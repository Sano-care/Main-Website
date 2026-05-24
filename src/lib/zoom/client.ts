// Zoom REST client. Thin wrapper over fetch() that knows how to:
//   - acquire and refresh an S2S OAuth bearer token (via ./auth.ts)
//   - build correct URLs (regional base, path-param encoding)
//   - surface typed errors instead of bare HTTP responses
//
// C2 surface is intentionally minimal — two GETs only:
//   * getUser(userIdOrEmail)         — for ops onboarding auto-fill
//   * getUserSettings(userIdOrEmail) — for the waiting-room sanity check
//
// C3 will add meeting/recording/webhook plumbing here as a separate
// expansion. Do not pre-stub C3 methods — keep this file's surface
// area exactly what C2 ships.

import { getZoomAccessToken, ZoomAuthError } from "./auth";
import type { ZoomUser, ZoomUserSettings } from "./types";

const ZOOM_API_BASE = "https://api.zoom.us/v2";

export class ZoomApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = "ZoomApiError";
  }
}

/**
 * Lightweight "not found" sentinel — useful for the ops UI ("no Zoom
 * user with this email" vs "Zoom is broken"). We don't subclass
 * ZoomApiError because exception narrowing in TypeScript is friendlier
 * with a status-code check than instanceof.
 */
export function isZoomNotFound(err: unknown): err is ZoomApiError {
  return err instanceof ZoomApiError && err.status === 404;
}

/**
 * GET /users/{userId}
 *
 * For Server-to-Server OAuth apps, `{userId}` accepts:
 *   - the Zoom user id (22-char base64-like hash), OR
 *   - the user's email address (URL-encoded).
 * DO NOT pass "me" — that's a user-OAuth-only keyword and will 401.
 *
 * Sanocare passes the email; we never store the Zoom user id until the
 * first successful auto-fill writes it back to doctors.zoom_user_id.
 *
 * Required scope: user:read:user:admin (granular).
 */
export async function getZoomUser(userIdOrEmail: string): Promise<ZoomUser> {
  return zoomGet<ZoomUser>(`/users/${encodeURIComponent(userIdOrEmail)}`);
}

/**
 * GET /users/{userId}/settings
 *
 * Same {userId} semantics as getZoomUser(). Returns the user's PMI /
 * waiting-room / scheduling settings — we use this for the
 * waiting-room sanity check on doctor onboarding.
 *
 * Required scope: user:read:settings:admin (granular).
 */
export async function getZoomUserSettings(
  userIdOrEmail: string,
): Promise<ZoomUserSettings> {
  return zoomGet<ZoomUserSettings>(
    `/users/${encodeURIComponent(userIdOrEmail)}/settings`,
  );
}

async function zoomGet<T>(path: string): Promise<T> {
  let token: string;
  try {
    token = await getZoomAccessToken();
  } catch (err) {
    // Auth errors bubble up untouched — caller can distinguish
    // ZoomAuthError (env vars / OAuth) from ZoomApiError (request).
    if (err instanceof ZoomAuthError) throw err;
    throw new ZoomAuthError("Failed to obtain Zoom access token.", err);
  }

  let response: Response;
  try {
    response = await fetch(`${ZOOM_API_BASE}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
  } catch (cause) {
    throw new ZoomApiError(
      `Network error calling Zoom (GET ${path}).`,
      0,
      cause,
    );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      code?: number;
      message?: string;
    };
    throw new ZoomApiError(
      `Zoom GET ${path} failed (HTTP ${response.status}): ${body.message ?? "no body"}`,
      response.status,
      body,
    );
  }

  return (await response.json()) as T;
}
