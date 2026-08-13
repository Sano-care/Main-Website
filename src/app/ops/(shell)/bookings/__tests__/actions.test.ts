// P0 regression guard — ops resource assignment must NOT gate on
// service_category. Before this fix, assignMedic threw
// "Can't assign a medic to a medic-at-home booking" on every real booking
// (the website writes T85 slugs, none of which were in the allow-lists),
// so bookings.medic_id was never populated across 90 bookings.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/consult/createSession", () => ({
  createTeleconsultSession: vi.fn(async () => ({
    joinToken: "join-tok",
    sessionId: "sess-1",
  })),
}));
vi.mock("@/lib/consult/meta", () => ({ sendConsultJoinLink: vi.fn() }));
vi.mock("@/lib/aarogya/meta", () => ({
  sendVisitComplete: vi.fn(),
  sendLabCollectionScheduled: vi.fn(),
  labTimeWindowFromDate: vi.fn(),
}));
vi.mock("@/lib/aarogya/labels", () => ({ serviceCategoryToSlug: (s: string) => s }));
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

import { assignDoctor, assignMedic, createBooking } from "../actions";
import { SERVICE_CATEGORIES } from "../../../_lib/bookingStatus";
import { createTeleconsultSession } from "@/lib/consult/createSession";

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

describe("SERVICE_CATEGORIES — exactly the 4 T85 slugs, no legacy", () => {
  it("is exactly the 4 canonical slugs", () => {
    expect([...SERVICE_CATEGORIES].sort()).toEqual(
      ["home-visit", "lab-tests", "medic-at-home", "teleconsultation"],
    );
  });
  it("no longer contains any retired value (migration 20260725150000)", () => {
    for (const legacy of ["homecare", "teleconsult", "chronic", "nursing", "diagnostics", "lab"]) {
      expect(SERVICE_CATEGORIES as readonly string[]).not.toContain(legacy);
    }
  });
});

// Richer fake supabase for createBooking: reads (doctors/customers) +
// bookings insert (payload captured) + next_code rpc.
function makeCreateSupabase(over: Resources = {}) {
  const inserts: { table: string; payload: Record<string, unknown> }[] = [];
  const resources: Resources = {
    doctors: {
      id: UUID,
      full_name: "Dr A",
      duty_room_join_url: "https://duty.example/x",
      is_active: true,
    },
    customers: { id: UUID, full_name: "Pat", phone: "+919812345678" },
    ...over,
  };
  const client = {
    from(table: string) {
      const node = {
        select() {
          return node;
        },
        eq() {
          return node;
        },
        maybeSingle: async () => ({ data: resources[table] ?? null, error: null }),
        insert(payload: Record<string, unknown>) {
          inserts.push({ table, payload });
          return {
            select: () => ({
              single: async () => ({ data: { id: "booking-1" }, error: null }),
            }),
          };
        },
      };
      return node;
    },
    rpc: async () => ({ data: "SAN-C-999", error: null }),
  };
  return { client, inserts };
}

const GPS = JSON.stringify({ lat: 28.5, lng: 77.2, accuracy: 10 });

describe("createBooking — T85 special-casing (item 4 bug)", () => {
  it("teleconsultation creates a consultation_session", async () => {
    const sb = makeCreateSupabase();
    clientForTest = sb.client;
    await createBooking(
      fd({
        customer_mode: "existing",
        customer_id: UUID,
        service_category: "teleconsultation",
        doctor_id: UUID,
        gps_location: GPS,
      }),
    );
    // The real bug: picking teleconsultation must build the video session.
    expect(createTeleconsultSession).toHaveBeenCalledTimes(1);
    const bk = sb.inserts.find((i) => i.table === "bookings")!.payload;
    expect(bk.service_category).toBe("teleconsultation");
    expect(bk.doctor_id).toBe(UUID);
  });

  it("lab-tests seeds lab_partner + PENDING_COLLECTION, no session", async () => {
    const sb = makeCreateSupabase();
    clientForTest = sb.client;
    await createBooking(
      fd({
        customer_mode: "existing",
        customer_id: UUID,
        service_category: "lab-tests",
        gps_location: GPS,
        selected_tests: JSON.stringify([{ code: "CBC", name: "CBC", price: 300 }]),
      }),
    );
    const bk = sb.inserts.find((i) => i.table === "bookings")!.payload;
    expect(bk.service_category).toBe("lab-tests");
    expect(bk.lab_partner).toBe("pathcore");
    expect(bk.status).toBe("PENDING_COLLECTION");
    expect(bk.report_payment_status).toBe("NOT_DUE");
    expect(createTeleconsultSession).not.toHaveBeenCalled();
  });

  it("home-visit + medic-at-home create a plain PENDING booking", async () => {
    for (const slug of ["home-visit", "medic-at-home"]) {
      const sb = makeCreateSupabase();
      clientForTest = sb.client;
      await createBooking(
        fd({
          customer_mode: "existing",
          customer_id: UUID,
          service_category: slug,
          gps_location: GPS,
        }),
      );
      const bk = sb.inserts.find((i) => i.table === "bookings")!.payload;
      expect(bk.service_category).toBe(slug);
      expect(bk.status).toBe("PENDING");
    }
  });

  it("rejects a retired service_category (can't create a legacy booking)", async () => {
    clientForTest = makeCreateSupabase().client;
    await expect(
      createBooking(
        fd({
          customer_mode: "existing",
          customer_id: UUID,
          service_category: "homecare",
          gps_location: GPS,
        }),
      ),
    ).rejects.toThrow(/Invalid service/);
  });
});
