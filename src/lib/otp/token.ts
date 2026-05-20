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

export const TOKEN_TTL_SECONDS = 30 * 60; // 30 min
export const OTP_TTL_SECONDS = 5 * 60; // 5 min
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_SENDS_PER_HOUR = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 30;

export const VERIFY_COOKIE_NAME = "sanocare_otp_verify";

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
}

export function mintVerificationToken(phone: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    phone,
    verifiedAt: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const encodedPayload = b64url(JSON.stringify(payload));
  const sig = sign(encodedPayload);
  return `${encodedPayload}.${sig}`;
}

export interface VerifiedToken {
  phone: string;
  verifiedAt: number;
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
  return { phone: payload.phone, verifiedAt: payload.verifiedAt };
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
