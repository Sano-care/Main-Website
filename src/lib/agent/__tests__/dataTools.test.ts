// Slice 4a C5 — getBookingHistory + getFamilyMembers tests.

import { describe, it, expect, vi, beforeEach } from "vitest";

interface BookingRow {
  id: string;
  booking_code: string | null;
  status: string;
  service_category: string | null;
  assigned_paramedic: string | null;
  dispatched_at: string | null;
  completed_at: string | null;
  created_at: string;
  phone: string;
}
interface FamilyRow {
  id: string;
  full_name: string;
  relation: string;
  relation_other: string | null;
  age: number | null;
  created_at: string;
  customer_id: string;
}

const h = vi.hoisted(() => ({
  bookings: [] as BookingRow[],
  families: [] as FamilyRow[],
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "bookings") {
        return {
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: h.bookings, error: null }),
            }),
          }),
        };
      }
      if (table === "family_members") {
        let filterCustomerId: string | null = null;
        const query = {
          select: () => query,
          eq: (_col: string, val: string) => {
            filterCustomerId = val;
            return query;
          },
          order: () =>
            Promise.resolve({
              data: h.families.filter((f) => f.customer_id === filterCustomerId),
              error: null,
            }),
        };
        return query;
      }
      return { select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: null, error: null }) }) }) };
    },
  },
}));

vi.mock("@/lib/agent/bookings", () => ({
  findBookingsByPhone: vi.fn(),
}));

vi.mock("@/lib/whatsapp/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  maskPhone: (p: string) => p,
}));

import { getBookingHistory, getFamilyMembers } from "@/lib/agent/dataTools";

beforeEach(() => {
  h.bookings = [];
  h.families = [];
});

const baseBooking = (over: Partial<BookingRow>): BookingRow => ({
  id: "bk-1",
  booking_code: null,
  status: "COMPLETED",
  service_category: "homecare",
  assigned_paramedic: null,
  dispatched_at: null,
  completed_at: null,
  created_at: "2026-06-01T00:00:00Z",
  phone: "+919811100001",
  ...over,
});

describe("getBookingHistory", () => {
  it("returns ALL bookings for the patient phone when filter='all'", async () => {
    h.bookings = [
      baseBooking({ id: "bk-a", status: "COMPLETED", phone: "+919811100001" }),
      baseBooking({ id: "bk-b", status: "PENDING", phone: "+919811100001" }),
      baseBooking({ id: "bk-other", phone: "+919876543210" }),
    ];
    const result = await getBookingHistory("+919811100001", "all");
    expect(result.map((b) => b.id)).toEqual(["bk-a", "bk-b"]);
  });

  it("filter='active' returns PENDING / PENDING_COLLECTION / CONFIRMED / DISPATCHED only", async () => {
    h.bookings = [
      baseBooking({ id: "bk-c", status: "COMPLETED" }),
      baseBooking({ id: "bk-p", status: "PENDING" }),
      baseBooking({ id: "bk-pc", status: "PENDING_COLLECTION" }),
      baseBooking({ id: "bk-d", status: "DISPATCHED" }),
      baseBooking({ id: "bk-x", status: "CANCELLED" }),
    ];
    const result = await getBookingHistory("+919811100001", "active");
    expect(result.map((b) => b.id).sort()).toEqual(["bk-d", "bk-p", "bk-pc"]);
  });

  it("filter='completed' returns COMPLETED only", async () => {
    h.bookings = [
      baseBooking({ id: "bk-c", status: "COMPLETED" }),
      baseBooking({ id: "bk-p", status: "PENDING" }),
    ];
    const result = await getBookingHistory("+919811100001", "completed");
    expect(result.map((b) => b.id)).toEqual(["bk-c"]);
  });

  it("filter defaults to 'all' when omitted", async () => {
    h.bookings = [
      baseBooking({ id: "bk-x", status: "PENDING" }),
      baseBooking({ id: "bk-y", status: "COMPLETED" }),
    ];
    const result = await getBookingHistory("+919811100001");
    expect(result.map((b) => b.id).sort()).toEqual(["bk-x", "bk-y"]);
  });

  it("scoping: another patient's bookings are NEVER returned (last-10 phone match)", async () => {
    h.bookings = [
      baseBooking({ id: "mine", phone: "+919811100001" }),
      baseBooking({ id: "theirs", phone: "+919876543210" }),
    ];
    const result = await getBookingHistory("+919811100001");
    expect(result.map((b) => b.id)).toEqual(["mine"]);
  });

  it("returns [] when the phone has < 10 digits (defensive)", async () => {
    h.bookings = [baseBooking({})];
    const result = await getBookingHistory("12345");
    expect(result).toEqual([]);
  });
});

describe("getFamilyMembers", () => {
  it("returns members for the given customerId, in created order", async () => {
    h.families = [
      { id: "fm-1", customer_id: "cus-A", full_name: "Asha", relation: "mother", relation_other: null, age: 60, created_at: "2026-05-01T00:00:00Z" },
      { id: "fm-2", customer_id: "cus-A", full_name: "Raj",  relation: "father", relation_other: null, age: 65, created_at: "2026-05-02T00:00:00Z" },
      { id: "fm-3", customer_id: "cus-B", full_name: "Other", relation: "other", relation_other: "uncle", age: 50, created_at: "2026-05-03T00:00:00Z" },
    ];
    const result = await getFamilyMembers("cus-A");
    expect(result.map((m) => m.id)).toEqual(["fm-1", "fm-2"]);
  });

  it("returns [] for a new visitor (no customerId)", async () => {
    const result = await getFamilyMembers(null);
    expect(result).toEqual([]);
  });

  it("returns [] for an empty-string customerId", async () => {
    const result = await getFamilyMembers("");
    expect(result).toEqual([]);
  });

  it("returns [] when the customer has no family members yet", async () => {
    h.families = [];
    const result = await getFamilyMembers("cus-empty");
    expect(result).toEqual([]);
  });
});
