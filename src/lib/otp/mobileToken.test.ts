import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  inserted: null as Record<string, unknown> | null,
  updated: null as Record<string, unknown> | null,
  selectRow: null as Record<string, unknown> | null,
  revokeRow: null as Record<string, unknown> | null,
  insertError: null as unknown,
}));

// Thenable Supabase builder mock: `await builder` resolves for insert/update-touch;
// `.maybeSingle()` resolves for read/revoke.
vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const ctx: { op: string } = { op: "read" };
      const result = () => {
        if (ctx.op === "insert") return { error: h.insertError };
        if (ctx.op === "update-touch") return { error: null };
        if (ctx.op === "revoke") return { data: h.revokeRow, error: null };
        return { data: h.selectRow, error: null };
      };
      const b: Record<string, unknown> = {
        insert: (row: Record<string, unknown>) => {
          h.inserted = row;
          ctx.op = "insert";
          return b;
        },
        update: (row: Record<string, unknown>) => {
          h.updated = row;
          ctx.op = "update-touch"; // upgraded to "revoke" if .select() is chained
          return b;
        },
        select: () => {
          if (ctx.op === "update-touch") ctx.op = "revoke";
          return b;
        },
        eq: () => b,
        is: () => b,
        maybeSingle: () => Promise.resolve(result()),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(result()).then(res, rej),
      };
      return b;
    },
  },
}));

import {
  bearerFromAuthHeader,
  isMobilePulseClient,
  mintMobileSessionToken,
  resolveMobileSessionCustomerId,
  revokeMobileSessionToken,
  MOBILE_CLIENT_VALUE,
} from "./mobileToken";

const HEX64 = /^[0-9a-f]{64}$/;

beforeEach(() => {
  h.inserted = null;
  h.updated = null;
  h.selectRow = null;
  h.revokeRow = null;
  h.insertError = null;
});

describe("bearerFromAuthHeader", () => {
  it("parses Bearer (case-insensitive), rejects other schemes / empty", () => {
    expect(bearerFromAuthHeader("Bearer abc.def")).toBe("abc.def");
    expect(bearerFromAuthHeader("bearer   xyz")).toBe("xyz");
    expect(bearerFromAuthHeader("Basic abc")).toBeNull();
    expect(bearerFromAuthHeader(null)).toBeNull();
    expect(bearerFromAuthHeader("")).toBeNull();
  });
});

describe("isMobilePulseClient", () => {
  const reqWith = (v: string | null) => ({ headers: { get: () => v } });
  it("matches the app header value only", () => {
    expect(isMobilePulseClient(reqWith(MOBILE_CLIENT_VALUE))).toBe(true);
    expect(isMobilePulseClient(reqWith("android-pulse"))).toBe(true);
    expect(isMobilePulseClient(reqWith("ANDROID-PULSE"))).toBe(true);
    expect(isMobilePulseClient(reqWith("web"))).toBe(false);
    expect(isMobilePulseClient(reqWith(null))).toBe(false);
  });
});

describe("mintMobileSessionToken", () => {
  it("returns an opaque raw token and stores only its sha256 hash + label", async () => {
    const raw = await mintMobileSessionToken({ customerId: "cust-1", deviceLabel: "Redmi Note 12" });
    expect(raw).toBeTruthy();
    expect(raw!.length).toBeGreaterThan(20);
    expect(h.inserted).toMatchObject({ customer_id: "cust-1", device_label: "Redmi Note 12" });
    // Stored value is the hash, never the raw token.
    expect(h.inserted!.token_hash).toMatch(HEX64);
    expect(h.inserted!.token_hash).not.toBe(raw);
  });

  it("mints unique tokens and null-safes a blank device label", async () => {
    const a = await mintMobileSessionToken({ customerId: "c", deviceLabel: "  " });
    expect(h.inserted!.device_label).toBeNull();
    const b = await mintMobileSessionToken({ customerId: "c" });
    expect(a).not.toBe(b);
  });

  it("returns null when the insert fails", async () => {
    h.insertError = { message: "boom" };
    expect(await mintMobileSessionToken({ customerId: "c" })).toBeNull();
  });
});

describe("resolveMobileSessionCustomerId", () => {
  it("returns customer_id for a live token and touches last_seen when stale", async () => {
    h.selectRow = { id: "tok-1", customer_id: "cust-9", last_seen_at: "2020-01-01T00:00:00Z" };
    const cid = await resolveMobileSessionCustomerId("rawtoken");
    expect(cid).toBe("cust-9");
    expect(h.updated).toMatchObject({ last_seen_at: expect.any(String) }); // stale → touched
  });

  it("does NOT touch last_seen when seen within the hour (throttle)", async () => {
    h.selectRow = { id: "tok-1", customer_id: "cust-9", last_seen_at: new Date().toISOString() };
    const cid = await resolveMobileSessionCustomerId("rawtoken");
    expect(cid).toBe("cust-9");
    expect(h.updated).toBeNull(); // fresh → skipped
  });

  it("returns null for an unknown/revoked token (no row)", async () => {
    h.selectRow = null;
    expect(await resolveMobileSessionCustomerId("rawtoken")).toBeNull();
    expect(await resolveMobileSessionCustomerId("")).toBeNull();
  });
});

describe("revokeMobileSessionToken", () => {
  it("sets revoked_at and reports whether a row matched", async () => {
    h.revokeRow = { id: "tok-1" };
    expect(await revokeMobileSessionToken("rawtoken")).toBe(true);
    expect(h.updated).toMatchObject({ revoked_at: expect.any(String) });

    h.revokeRow = null;
    expect(await revokeMobileSessionToken("rawtoken")).toBe(false);
  });
});
