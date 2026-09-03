// P0 regression guard — ops resource assignment must NOT gate on
// service_category. Before this fix, assignMedic threw
// "Can't assign a medic to a medic-at-home booking" on every real booking
// (the website writes T85 slugs, none of which were in the allow-lists),
// so bookings.medic_id was never populated across 90 bookings.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/consult/createSession", () => ({ createTeleconsultSession: vi.fn() }));
vi.mock("@/lib/consult/meta", () => ({ sendConsultJoinLink: vi.fn() }));
vi.mock("@/lib/aarogya/meta", () => ({
  sendVisitComplete: vi.fn(),
  sendLabCollectionScheduled: vi.fn(),
  labTimeWindowFromDate: vi.fn(),
}));
vi.mock("@/lib/aarogya/labels", () => ({ serviceCategoryToSlug: (s: string) => s }));
// createBooking dynamically imports this (server-only) — mock it so the real
// supabaseAdmin isn't constructed during the test.
vi.mock("@/lib/wa/attribution", () => ({ attachClickIdsToBooking: vi.fn() }));
vi.mock("@/lib/whatsapp/slice3Dispatcher", () => ({
  notifyOnMedicAssigned: vi.fn(async () => ({})),
}));
vi.mock("../../../_lib/getCurrentOpsUser", () => ({
  getCurrentOpsUser: vi.fn(async () => ({ id: "ops-1" })),
}));

// The supabase client is swapped per test via this module-level handle.
let clientForTest: unknown;
vi.mock("@/lib/supabase-rsc", () => ({
  createOpsRSCClient: vi.fn(async () => clientForTest),
}));

import { assignDoctor, assignMedic } from "../actions";
import { SERVICE_CATEGORIES } from "../../../_lib/bookingStatus";

type Resources = Record<string, Record<string, unknown> | null>;

/**
 * Minimal fake supabase honouring the two shapes the assign actions use:
 *   read:  from(t).select(cols).eq(col,val).maybeSingle()
 *   write: from(t).update(payload).eq(col,val)   (awaited)
 * Captures every write so tests can assert the assignment landed. Also
 * records which tables were READ — proving the action no longer reads
 * bookings.service_category (the removed gate).
 */
function makeSupabase(resources: Resources) {
  const updates: { table: string; payload: Record<string, unknown> }[] = [];
  const reads: string[] = [];
  const client = {
    from(table: string) {
      const node = {
        select() {
          reads.push(table);
          return node;
        },
        eq() {
          return node;
        },
        maybeSingle: async () => ({ data: resources[table] ?? null, error: null }),
        update(payload: Record<string, unknown>) {
          updates.push({ table, payload });
          return { eq: async () => ({ error: null }) };
        },
      };
      return node;
    },
  };
  return { client, updates, reads };
}

const UUID = "11111111-1111-1111-1111-111111111111";
const fd = (obj: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.set(k, v);
  return f;
};

beforeEach(() => vi.clearAllMocks());

describe("assignMedic — no service_category gate", () => {
  it("assigns a medic to a 'medic-at-home' booking (previously threw)", async () => {
    const sb = makeSupabase({ medics: { id: UUID, active: true } });
    clientForTest = sb.client;

    await expect(
      assignMedic(fd({ booking_id: UUID, medic_id: UUID })),
    ).resolves.not.toThrow();

    const write = sb.updates.find((u) => u.table === "bookings");
    expect(write).toBeTruthy();
    expect(write!.payload.medic_id).toBe(UUID);
    expect(write!.payload.assigned_at).toBeTruthy(); // audit stamp kept
    expect(write!.payload.assigned_by).toBe("ops-1");
    // The gate is gone: the action never reads the booking's service_category.
    expect(sb.reads).not.toContain("bookings");
  });

  it("rejects an inactive medic (resource-active check kept)", async () => {
    clientForTest = makeSupabase({ medics: { id: UUID, active: false } }).client;
    await expect(
      assignMedic(fd({ booking_id: UUID, medic_id: UUID })),
    ).rejects.toThrow(/inactive/i);
  });

  it("unassign clears medic_id (no audit stamp)", async () => {
    const sb = makeSupabase({});
    clientForTest = sb.client;
    await assignMedic(fd({ booking_id: UUID, medic_id: "" }));
    const write = sb.updates.find((u) => u.table === "bookings");
    expect(write!.payload).toEqual({ medic_id: null });
  });
});

describe("assignDoctor + assignMedic on the SAME booking", () => {
  it("both succeed and write to the same booking (combination staffing)", async () => {
    const sbDoc = makeSupabase({ doctors: { id: UUID, is_active: true } });
    clientForTest = sbDoc.client;
    await assignDoctor(fd({ booking_id: UUID, doctor_id: UUID }));

    const sbMed = makeSupabase({ medics: { id: UUID, active: true } });
    clientForTest = sbMed.client;
    await assignMedic(fd({ booking_id: UUID, medic_id: UUID }));

    expect(sbDoc.updates.find((u) => u.table === "bookings")!.payload.doctor_id).toBe(UUID);
    expect(sbMed.updates.find((u) => u.table === "bookings")!.payload.medic_id).toBe(UUID);
    // Neither read the booking's service_category.
    expect([...sbDoc.reads, ...sbMed.reads]).not.toContain("bookings");
  });
});

describe("SERVICE_CATEGORIES — ops can create a 'medic-at-home' booking", () => {
  it("accepts the T85 slugs the website writes", () => {
    for (const slug of ["medic-at-home", "home-visit", "teleconsultation", "lab-tests"]) {
      expect(SERVICE_CATEGORIES as readonly string[]).toContain(slug);
    }
  });
  it("keeps the legacy values valid for existing rows", () => {
    for (const legacy of ["homecare", "teleconsult", "chronic", "diagnostics"]) {
      expect(SERVICE_CATEGORIES as readonly string[]).toContain(legacy);
    }
  });
});
