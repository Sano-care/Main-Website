// OTP hashing + verification-token signing.
//
// All crypto goes through Node's built-in `crypto`. No new deps.
//
// Hash:  hashOtp(code) = HMAC-SHA256(code, OTP_HASH_PEPPER)
//   The pepper is a single server-side secret that turns the 6-digit space
//   from "trivially brute-forceable" (1M values) into "infeasible without
//   leaking the secret too." Stored only in env.
//
// Token: A short-lived signed cookie minted on /api/auth/verify-otp success
//   and validated by every booking-insert route. Format:
//     base64url(JSON.stringify({ phone, verifiedAt, exp })) + "." +
//     base64url(HMAC-SHA256(payload, OTP_TOKEN_SECRET))
//   The signature pins the payload to the server's secret; tampering invalidates.

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const TOKEN_TTL_SECONDS = 30 * 60; // 30 min — the "session" cookie path
export const OTP_TTL_SECONDS = 5 * 60; // 5 min
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_SENDS_PER_HOUR = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 30;

// T90 Pulse v1 Phase 1 — "stay signed in on this phone" path.
// 365 days is the browser-enforced upper bound for cookie Max-Age in
// modern browsers per RFC 6265bis; we mirror it both as the cookie
// Max-Age and as the token's `exp` so the in-payload expiry can't
// outlive the cookie.
export const PULSE_LONG_TTL_SECONDS = 365 * 24 * 60 * 60;

export const VERIFY_COOKIE_NAME = "sanocare_otp_verify";

// ===== Doctor session (C1) =====
// Distinct cookie name so a single browser can carry a patient verify
// cookie and a doctor session cookie without collision, and so the
// doctor-side verify path cannot be satisfied by a stolen patient cookie
// (different cookie name + kind discriminator in the payload, see below).
export const DOCTOR_SESSION_COOKIE_NAME = "sanocare_doctor_session";

// 8 hours — a typical working shift. Longer than the patient verify
// token (30 min) because /doctor is a working surface, not a one-shot
// booking submission. Shorter than a week so a stolen device times out
// without admin intervention.
export const DOCTOR_TOKEN_TTL_SECONDS = 8 * 60 * 60;

/** Normalise any phone input to E.164 with +91 prefix. Returns null if invalid. */
export function normaliseIndianPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  // Accept: 10 digits, 11 digits with leading 0, 12 digits with leading 91
  let local: string;
  if (digits.length === 10) {
    local = digits;
  } else if (digits.length === 11 && digits.startsWith("0")) {
    local = digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith("91")) {
    local = digits.slice(2);
  } else {
    return null;
  }
  // Indian mobile numbers start with 6-9
  if (!/^[6-9]\d{9}$/.test(local)) return null;
  return `+91${local}`;
}

/** Generate a 6-digit OTP using a cryptographically-strong RNG. */
export function generateOtp(): string {
  // randomInt is uniform; 6-digit numeric padded with leading zeros.
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(code: string): string {
  const pepper = requireEnv("OTP_HASH_PEPPER");
  return createHmac("sha256", pepper).update(code).digest("hex");
}

/** Constant-time hex compare. Throws if lengths differ (always 64 here). */
export function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

// ===== Signed verification token =====

interface TokenPayload {
  phone: string;
  verifiedAt: number; // unix seconds
  exp: number; // unix seconds
  /**
   * T90: when true, the user opted into "Stay signed in on this phone" on
   * the onboarding Step 1 checkbox. Drives the long Max-Age + sliding
   * renewal in `requirePulseCustomer`. Optional in storage shape so old
   * pre-T90 tokens (no field) still parse — verifyToken applies a `?? true`
   * fallback so existing active sessions keep working without re-OTP.
   */
  staySignedIn?: boolean;
}

/**
 * Mint a signed verification token. `staySignedIn` controls the in-payload
 * `exp` (which the cookie's Max-Age should mirror — see `pulseCookieOptions`):
 *   - true  → exp = now + PULSE_LONG_TTL_SECONDS (1 year)
 *   - false → exp = now + TOKEN_TTL_SECONDS (30 min)
 */
export function mintVerificationToken(
  phone: string,
  staySignedIn: boolean,
): string {
  const now = Math.floor(Date.now() / 1000);
  const ttl = staySignedIn ? PULSE_LONG_TTL_SECONDS : TOKEN_TTL_SECONDS;
  const payload: TokenPayload = {
    phone,
    verifiedAt: now,
    exp: now + ttl,
    staySignedIn,
  };
  const encodedPayload = b64url(JSON.stringify(payload));
  const sig = sign(encodedPayload);
  return `${encodedPayload}.${sig}`;
}

export interface VerifiedToken {
  phone: string;
  verifiedAt: number;
  /**
   * Always present at the API boundary — back-filled to `true` for old
   * tokens that pre-date the field (founder direction: don't kick active
   * sessions out; their next API hit renews into the new payload shape).
   */
  staySignedIn: boolean;
}

/**
 * Returns the verified phone payload if the token is well-formed, signed, and
 * still within its TTL. Returns null on any failure — never throws so callers
 * can keep a uniform "reject with 401" path.
 */
export function verifyToken(token: string | undefined | null): VerifiedToken | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, providedSig] = parts;
  const expectedSig = sign(encodedPayload);
  if (providedSig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedSig))) {
    return null;
  }
  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload.phone !== "string") return null;
  if (typeof payload.exp !== "number") return null;
  if (Math.floor(Date.now() / 1000) >= payload.exp) return null;
  return {
    phone: payload.phone,
    verifiedAt: payload.verifiedAt,
    // T90 back-compat: tokens minted before this field existed default to
    // `true`. Combined with sliding renewal in requirePulseCustomer, the
    // next authenticated API hit re-mints into the new payload shape.
    staySignedIn: payload.staySignedIn ?? true,
  };
}

/**
 * T90: convenience wrapper around mintVerificationToken used by the sliding-
 * renewal path in `requirePulseCustomer`. Takes a previously-verified token
 * payload and re-mints with a fresh `exp`, preserving `staySignedIn`.
 */
export function renewVerificationToken(verified: VerifiedToken): string {
  return mintVerificationToken(verified.phone, verified.staySignedIn);
}

/**
 * T90: single source of truth for the Pulse verify cookie's security flags.
 * Both verify-otp (initial mint) and requirePulseCustomer (sliding renewal)
 * must call this so flags can't drift.
 *
 * Pass `maxAge` in seconds for a persistent cookie (long TTL path), or
 * `null` for a session cookie (cleared on browser close — the
 * "Stay signed in" off path).
 */
export function pulseCookieOptions(maxAge: number | null): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge?: number;
} {
  const base = {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/" as const,
  };
  return maxAge === null ? base : { ...base, maxAge };
}

function sign(payload: string): string {
  const secret = requireEnv("OTP_TOKEN_SECRET");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}.`);
  }
  return value;
}

// ===== Doctor session token (C1) =====
// Same HMAC-SHA256 mechanism + same OTP_TOKEN_SECRET as the patient
// verify token, distinguished by:
//   1. A `kind: "doctor"` discriminator in the payload — verifyDoctorToken
//      rejects any token without it, so a patient verify token replayed
//      under DOCTOR_SESSION_COOKIE_NAME cannot satisfy the doctor verifier.
//   2. The doctor_id field — verifyDoctorToken requires a uuid-shaped value.
// The shared secret keeps env-var management simple; the kind discriminator
// is the actual cross-replay defence.

interface DoctorTokenPayload {
  kind: "doctor";
  doctor_id: string;
  phone: string;
  verifiedAt: number; // unix seconds
  exp: number; // unix seconds
}

export function mintDoctorToken(input: { doctor_id: string; phone: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: DoctorTokenPayload = {
    kind: "doctor",
    doctor_id: input.doctor_id,
    phone: input.phone,
    verifiedAt: now,
    exp: now + DOCTOR_TOKEN_TTL_SECONDS,
  };
  const encodedPayload = b64url(JSON.stringify(payload));
  const sig = sign(encodedPayload);
  return `${encodedPayload}.${sig}`;
}

export interface VerifiedDoctorToken {
  doctor_id: string;
  phone: string;
  verifiedAt: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the verified doctor session payload if the token is well-formed,
 * signed, still within TTL, AND carries the `kind: "doctor"` discriminator.
 * Returns null on any failure — never throws so callers can keep a uniform
 * "reject with 401 / redirect to /doctor/login" path.
 */
export function verifyDoctorToken(token: string | undefined | null): VerifiedDoctorToken | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, providedSig] = parts;
  const expectedSig = sign(encodedPayload);
  if (providedSig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedSig))) {
    return null;
  }
  let payload: Partial<DoctorTokenPayload>;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || payload.kind !== "doctor") return null;
  if (typeof payload.doctor_id !== "string" || !UUID_RE.test(payload.doctor_id)) return null;
  if (typeof payload.phone !== "string") return null;
  if (typeof payload.exp !== "number") return null;
  if (typeof payload.verifiedAt !== "number") return null;
  if (Math.floor(Date.now() / 1000) >= payload.exp) return null;
  return {
    doctor_id: payload.doctor_id,
    phone: payload.phone,
    verifiedAt: payload.verifiedAt,
  };
}
