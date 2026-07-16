import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  // web cookie path
  cookieValid: true,
  customerFromToken: { id: "cust-cookie", full_name: "Web User", phone: "+919999999999" } as
    | { id: string; full_name: string | null; phone: string }
    | null,
  // mobile bearer path
  mobileCustomerId: null as string | null,
  customerById: { id: "cust-bearer", full_name: "App User", phone: "+918888888888" } as
    | { id: string; full_name: string | null; phone: string }
    | null,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: vi.fn() })),
}));

vi.mock("@/lib/otp/token", () => ({
  VERIFY_COOKIE_NAME: "sanocare_otp_verify",
  PULSE_LONG_TTL_SECONDS: 31536000,
  // staySignedIn:false → requirePulseCustomer skips the sliding-renewal cookie write.
  verifyToken: vi.fn((t: string | undefined) =>
    t && h.cookieValid ? { phone: "+919999999999", verifiedAt: 0, staySignedIn: false } : null,
  ),
  renewVerificationToken: vi.fn(() => "renewed"),
  pulseCookieOptions: vi.fn(() => ({})),
}));

vi.mock("./getCurrentCustomer", () => ({
  resolveCustomerFromToken: vi.fn(async () => h.customerFromToken),
  resolveCustomerById: vi.fn(async () => h.customerById),
}));

vi.mock("@/lib/otp/mobileToken", () => ({
  bearerFromAuthHeader: (header: string | null) => {
    if (!header) return null;
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    return m ? m[1].trim() : null;
  },
  resolveMobileSessionCustomerId: vi.fn(async () => h.mobileCustomerId),
}));

import { requirePulseCustomer } from "./requireCustomer";

function req(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://t/api/pulse/records", { headers });
}

beforeEach(() => {
  h.cookieValid = true;
  h.customerFromToken = { id: "cust-cookie", full_name: "Web User", phone: "+919999999999" };
  h.mobileCustomerId = null;
  h.customerById = { id: "cust-bearer", full_name: "App User", phone: "+918888888888" };
});

describe("requirePulseCustomer — bearer path (native app)", () => {
  it("resolves a valid Bearer token to its customer", async () => {
    h.mobileCustomerId = "cust-bearer";
    const auth = await requirePulseCustomer(req({ authorization: "Bearer good-token" }));
    expect("customer" in auth).toBe(true);
    if ("customer" in auth) expect(auth.customer.id).toBe("cust-bearer");
  });

  it("401s an unknown/revoked Bearer token (resolver → null) — never falls through to the cookie", async () => {
    h.mobileCustomerId = null; // revoked or unknown
    // A cookie is ALSO present; the bearer path must not silently fall through to it.
    const auth = await requirePulseCustomer(
      req({ authorization: "Bearer revoked", cookie: "sanocare_otp_verify=abc" }),
    );
    expect("response" in auth).toBe(true);
    if ("response" in auth) expect(auth.response.status).toBe(401);
  });
});

describe("requirePulseCustomer — web cookie path (unchanged)", () => {
  it("resolves a valid cookie when no bearer header is present", async () => {
    const auth = await requirePulseCustomer(req({ cookie: "sanocare_otp_verify=abc" }));
    expect("customer" in auth).toBe(true);
    if ("customer" in auth) expect(auth.customer.id).toBe("cust-cookie");
  });

  it("401s when neither a bearer nor a valid cookie is present", async () => {
    h.cookieValid = false;
    const auth = await requirePulseCustomer(req({}));
    expect("response" in auth).toBe(true);
    if ("response" in auth) expect(auth.response.status).toBe(401);
  });
});
