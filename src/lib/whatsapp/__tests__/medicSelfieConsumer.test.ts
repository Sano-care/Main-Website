// Aarogya Medic selfie consumer — unit tests.
//
// Covers the four founder cases + the role gate + the never-throws / persist
// properties, with supabase / media-fetch / store injected. (The adapter
// sibling-branch routing + the non-text never-zero-output fix are build-verified
// and exercised by the agent harness.)

import { describe, it, expect, vi } from "vitest";

// supabase-server calls createClient at import (needs env that vitest lacks); the
// consumer injects its own supabase in tests, so stub the module to a no-op.
vi.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import {
  runMedicSelfieTurn,
  workDateIST,
} from "@/lib/whatsapp/medicSelfieConsumer";
import type { Identity } from "@/lib/whatsapp/identity";

const MEDIC: Identity = { role: "medic", medicId: "med-1", fullName: "Naveen" };
const RAW = { type: "image", image: { id: "wamid-1", mime_type: "image/jpeg" } };

function makeSupabase(opts: {
  row?: { id: string; selfie_verified_at: string | null } | null;
  lookupError?: { message: string } | null;
  updateError?: { message: string } | null;
}) {
  const calls = {
    updateVals: null as Record<string, unknown> | null,
    lookupConds: {} as Record<string, unknown>,
    updateConds: {} as Record<string, unknown>,
  };
  const supabase = {
    calls,
    from() {
      let mode: "select" | "update" | null = null;
      const b: Record<string, unknown> = {};
      b.select = () => {
        mode = "select";
        return b;
      };
      b.update = (vals: Record<string, unknown>) => {
        mode = "update";
        calls.updateVals = vals;
        return b;
      };
      b.eq = (col: string, val: unknown) => {
        (mode === "update" ? calls.updateConds : calls.lookupConds)[col] = val;
        return b;
      };
      b.is = (col: string, val: unknown) => {
        calls.updateConds[col] = val;
        return Promise.resolve({ error: opts.updateError ?? null });
      };
      b.maybeSingle = () =>
        Promise.resolve({ data: opts.row ?? null, error: opts.lookupError ?? null });
      return b;
    },
  };
  return supabase;
}

function fetchOk() {
  return vi.fn(async () => ({
    ok: true as const,
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "image/jpeg",
  }));
}
function storeOk() {
  return vi.fn(async (a: { bucket: string; path: string }) => ({
    ok: true as const,
    bucket: a.bucket,
    path: a.path,
  }));
}

const NOW = Date.parse("2026-06-24T10:00:00+05:30");
const baseDeps = () => ({
  fetchMedia: fetchOk(),
  store: storeOk(),
  now: () => NOW,
});

describe("runMedicSelfieTurn", () => {
  it("open unverified clock-in today → sets selfie_verified_at + ack + VERIFIED audit", async () => {
    const supabase = makeSupabase({ row: { id: "att-1", selfie_verified_at: null } });
    const deps = { ...baseDeps(), supabase: supabase as never };
    const res = await runMedicSelfieTurn({ raw: RAW, identity: MEDIC }, deps);

    expect(supabase.calls.updateVals).toMatchObject({ selfie_verified_at: expect.any(String) });
    expect(supabase.calls.updateConds).toMatchObject({ id: "att-1", selfie_verified_at: null }); // only-if-null guard
    expect(res.reply).toMatch(/attendance confirmed/i);
    expect(res.audits.map((a) => a.event)).toContain("medic_selfie_verified");
    expect(res.audits[0].data).toMatchObject({ attendance_id: "att-1" });
  });

  it("already verified → idempotent ack, NO write, no second post", async () => {
    const supabase = makeSupabase({
      row: { id: "att-1", selfie_verified_at: "2026-06-24T09:00:00Z" },
    });
    const res = await runMedicSelfieTurn(
      { raw: RAW, identity: MEDIC },
      { ...baseDeps(), supabase: supabase as never },
    );
    expect(supabase.calls.updateVals).toBeNull();
    expect(res.reply).toMatch(/already marked present/i);
    expect(res.audits).toHaveLength(0);
  });

  it("no clock-in today → friendly prompt, flag NOT set, NO_CLOCKIN audit", async () => {
    const supabase = makeSupabase({ row: null });
    const res = await runMedicSelfieTurn(
      { raw: RAW, identity: MEDIC },
      { ...baseDeps(), supabase: supabase as never },
    );
    expect(supabase.calls.updateVals).toBeNull();
    expect(res.reply).toMatch(/don't see a clock-in/i);
    expect(res.audits.map((a) => a.event)).toEqual(["medic_selfie_no_clockin"]);
  });

  it("role gate: a non-medic never touches attendance", async () => {
    const supabase = makeSupabase({ row: { id: "att-1", selfie_verified_at: null } });
    const res = await runMedicSelfieTurn(
      { raw: RAW, identity: { role: "customer", subRole: "new" } },
      { ...baseDeps(), supabase: supabase as never },
    );
    expect(supabase.calls.updateVals).toBeNull();
    expect(supabase.calls.lookupConds).toEqual({});
    expect(res.audits).toHaveLength(0);
  });

  it("persists the selfie to the private ops-media bucket with a 72h purge class", async () => {
    const supabase = makeSupabase({ row: { id: "att-1", selfie_verified_at: null } });
    const store = storeOk();
    await runMedicSelfieTurn(
      { raw: RAW, identity: MEDIC },
      { ...baseDeps(), store, supabase: supabase as never },
    );
    expect(store).toHaveBeenCalledTimes(1);
    const arg = store.mock.calls[0][0] as unknown as {
      bucket: string;
      ownerId: string;
      purgeAfter: Date;
    };
    expect(arg.bucket).toBe("ops-media");
    expect(arg.ownerId).toBe("med-1");
    expect(arg.purgeAfter.getTime()).toBe(NOW + 72 * 60 * 60 * 1000);
  });

  it("never throws: a media-fetch failure still returns a reply", async () => {
    const supabase = makeSupabase({ row: null });
    const fetchMedia = vi.fn(async () => {
      throw new Error("network");
    });
    const res = await runMedicSelfieTurn(
      { raw: RAW, identity: MEDIC },
      { ...baseDeps(), fetchMedia, supabase: supabase as never },
    );
    expect(res.reply).toMatch(/don't see a clock-in/i); // attendance path still ran
  });

  it("workDateIST matches the IST (UTC+5:30) basis of the clock-in route", () => {
    // 2026-06-23T20:30:00Z = 2026-06-24T02:00 IST → work_date is the 24th.
    expect(workDateIST(Date.parse("2026-06-23T20:30:00Z"))).toBe("2026-06-24");
  });
});
