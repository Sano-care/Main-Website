// Paid-attribution pipeline tests — the token parse/strip helpers, the
// conversation stamp, the phone-normalised 90-day booking lookup, and the
// best-effort booking attach (must never fail a booking).

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// attribution.ts + clickToken.ts are server-only and createClient() supabaseAdmin
// at import — break that chain and give a test-controlled db + resolver.
vi.mock("server-only", () => ({}));

// hoisted so the vi.mock factory below can reference it without a TDZ error.
const { holder } = vi.hoisted(() => ({
  holder: { db: null as { from: (t: string) => unknown } | null },
}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (t: string) => holder.db!.from(t) },
}));
vi.mock("@/lib/wa/clickToken", () => ({
  resolveWaClickToken: vi.fn(),
}));

import { extractWaRefToken, stripWaRef } from "@/lib/wa/refToken";
import { buildWaHrefFromRef } from "@/lib/wa/clientRef";
import { resolveWaClickToken } from "@/lib/wa/clickToken";
import {
  stampConversationClickAttribution,
  findClickIdsForPhone,
  attachClickIdsToBooking,
} from "@/lib/wa/attribution";

type Row = Record<string, unknown>;

/** Minimal in-memory Supabase honouring the chain the attribution code uses. */
function makeDb(seed: { conversations?: Row[]; bookings?: Row[] } = {}) {
  const tables: Record<string, Row[]> = {
    conversations: (seed.conversations ?? []).map((r) => ({ ...r })),
    bookings: (seed.bookings ?? []).map((r) => ({ ...r })),
  };
  const from = (table: string) => {
    const rows = tables[table] ?? (tables[table] = []);
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "update" = "select";
    let payload: Row = {};
    let orderKey: string | null = null;
    let orderAsc = true;
    let limitN: number | null = null;

    const matched = () => {
      let res = rows.filter((r) => filters.every((f) => f(r)));
      if (orderKey) {
        const k = orderKey;
        res = [...res].sort((a, b) => {
          const av = String(a[k] ?? "");
          const bv = String(b[k] ?? "");
          return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (limitN != null) res = res.slice(0, limitN);
      return res;
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      update: (p: Row) => {
        op = "update";
        payload = p;
        return builder;
      },
      not: (col: string) => {
        filters.push((r) => r[col] != null);
        return builder;
      },
      is: (col: string, v: unknown) => {
        filters.push((r) => (v === null ? r[col] == null : r[col] === v));
        return builder;
      },
      eq: (col: string, v: unknown) => {
        filters.push((r) => r[col] === v);
        return builder;
      },
      like: (col: string, pat: string) => {
        const suffix = pat.replace(/^%/, "");
        filters.push((r) => String(r[col] ?? "").endsWith(suffix));
        return builder;
      },
      gte: (col: string, v: unknown) => {
        filters.push((r) => String(r[col] ?? "") >= String(v));
        return builder;
      },
      order: (col: string, o?: { ascending?: boolean }) => {
        orderKey = col;
        orderAsc = o?.ascending ?? true;
        return builder;
      },
      limit: (n: number) => {
        limitN = n;
        return builder;
      },
      maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => {
        if (op === "update") {
          matched().forEach((r) => Object.assign(r, payload));
          return resolve({ data: null, error: null });
        }
        return resolve({ data: matched(), error: null });
      },
    };
    return builder;
  };
  return { db: { from } as unknown as SupabaseClient, tables };
}

const NOW = Date.parse("2026-08-23T12:00:00Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.mocked(resolveWaClickToken).mockReset();
});

describe("refToken helpers", () => {
  it("parses AND strips a trailing [ref: …] token", () => {
    const text = "Hi Sanocare [ref: SC-AB12CD]";
    expect(extractWaRefToken(text)).toBe("SC-AB12CD");
    expect(stripWaRef(text)).toBe("Hi Sanocare");
  });

  it("strips a mid-string token + collapses whitespace", () => {
    expect(stripWaRef("book [ref: SC-AB12CD] now")).toBe("book now");
  });

  it("token absent → extract null, strip unchanged", () => {
    expect(extractWaRefToken("Hi there")).toBeNull();
    expect(stripWaRef("Hi there")).toBe("Hi there");
  });

  it("null/empty handled cleanly", () => {
    expect(extractWaRefToken(null)).toBeNull();
    expect(stripWaRef(null)).toBe("");
  });
});

describe("buildWaHrefFromRef", () => {
  it("untracked (no ref) with a message → plain prefill, human-readable unchanged", () => {
    expect(buildWaHrefFromRef("Hi, I'd like to book a Sanocare visit", null)).toBe(
      "https://wa.me/919711977782?text=Hi%2C%20I'd%20like%20to%20book%20a%20Sanocare%20visit",
    );
  });

  it("untracked with no message → bare chat link", () => {
    expect(buildWaHrefFromRef(undefined, null)).toBe("https://wa.me/919711977782");
  });

  it("tracked → appends [ref: …] at the END", () => {
    const href = buildWaHrefFromRef("Hi", "SC-AB12CD");
    expect(decodeURIComponent(href)).toBe(
      "https://wa.me/919711977782?text=Hi [ref: SC-AB12CD]",
    );
  });
});

describe("stampConversationClickAttribution", () => {
  it("no token → no lookup, no write", async () => {
    const { db, tables } = makeDb({ conversations: [{ id: "c1", gclid: null }] });
    holder.db = db;
    await stampConversationClickAttribution({ conversationId: "c1", refToken: null });
    expect(resolveWaClickToken).not.toHaveBeenCalled();
    expect(tables.conversations[0].gclid).toBeNull();
  });

  it("unknown token → resolver returns null → no write", async () => {
    const { db, tables } = makeDb({ conversations: [{ id: "c1", gclid: null }] });
    holder.db = db;
    vi.mocked(resolveWaClickToken).mockResolvedValue(null);
    await stampConversationClickAttribution({ conversationId: "c1", refToken: "SC-ZZZZZZ" });
    expect(tables.conversations[0].gclid).toBeNull();
  });

  it("known token → stamps gclid + wbraid (first-click-wins)", async () => {
    const { db, tables } = makeDb({ conversations: [{ id: "c1", gclid: null }] });
    holder.db = db;
    vi.mocked(resolveWaClickToken).mockResolvedValue({ gclid: "G-1", wbraid: "W-1" });
    await stampConversationClickAttribution({ conversationId: "c1", refToken: "SC-AB12CD" });
    expect(tables.conversations[0].gclid).toBe("G-1");
    expect(tables.conversations[0].wbraid).toBe("W-1");
  });
});

describe("findClickIdsForPhone", () => {
  const conv = (over: Row = {}): Row => ({
    id: "c1",
    gclid: "G-1",
    wbraid: "W-1",
    whatsapp_phone: "+919812345678",
    created_at: iso(1 * DAY),
    ...over,
  });

  it.each([
    ["+919812345678"],
    ["919812345678"],
    ["9812345678"],
    ["+91 98123 45678"],
  ])("normalises phone format %s to the same conversation", async (phone) => {
    const { db } = makeDb({ conversations: [conv()] });
    holder.db = db;
    const r = await findClickIdsForPhone(phone, NOW);
    expect(r.gclid).toBe("G-1");
    expect(r.wbraid).toBe("W-1");
  });

  it("expired (>90 day) click is NOT copied", async () => {
    const { db } = makeDb({ conversations: [conv({ created_at: iso(120 * DAY) })] });
    holder.db = db;
    const r = await findClickIdsForPhone("9812345678", NOW);
    expect(r.gclid).toBeNull();
  });

  it("a click just inside 90 days IS copied", async () => {
    const { db } = makeDb({ conversations: [conv({ created_at: iso(89 * DAY) })] });
    holder.db = db;
    const r = await findClickIdsForPhone("9812345678", NOW);
    expect(r.gclid).toBe("G-1");
  });

  it("no matching conversation → empty", async () => {
    const { db } = makeDb({ conversations: [conv({ whatsapp_phone: "+919999999999" })] });
    holder.db = db;
    const r = await findClickIdsForPhone("9812345678", NOW);
    expect(r.gclid).toBeNull();
  });
});

describe("attachClickIdsToBooking", () => {
  it("copies the gclid onto the booking at creation", async () => {
    const { db, tables } = makeDb({
      conversations: [
        { id: "c1", gclid: "G-1", wbraid: "W-1", whatsapp_phone: "+919812345678", created_at: iso(DAY) },
      ],
      bookings: [{ id: "b1", gclid: null }],
    });
    holder.db = db;
    await attachClickIdsToBooking({ bookingId: "b1", phone: "9812345678", refTimeMs: NOW });
    expect(tables.bookings[0].gclid).toBe("G-1");
    expect(tables.bookings[0].wbraid).toBe("W-1");
  });

  it("no gclid for the phone → booking untouched (no-op)", async () => {
    const { db, tables } = makeDb({
      conversations: [],
      bookings: [{ id: "b1", gclid: null }],
    });
    holder.db = db;
    await attachClickIdsToBooking({ bookingId: "b1", phone: "9812345678", refTimeMs: NOW });
    expect(tables.bookings[0].gclid).toBeNull();
  });

  it("NEVER throws even when every lookup fails (booking must still succeed)", async () => {
    holder.db = {
      from: () => {
        throw new Error("db down");
      },
    };
    await expect(
      attachClickIdsToBooking({ bookingId: "b1", phone: "9812345678", refTimeMs: NOW }),
    ).resolves.toBeUndefined();
  });

  it("missing bookingId or phone → no-op", async () => {
    const { db } = makeDb();
    holder.db = db;
    await expect(
      attachClickIdsToBooking({ bookingId: null, phone: "9812345678" }),
    ).resolves.toBeUndefined();
    await expect(
      attachClickIdsToBooking({ bookingId: "b1", phone: null }),
    ).resolves.toBeUndefined();
  });
});
