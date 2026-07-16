// JustDial lead-push webhook — category mapping, notes, ops-alert mapping, and
// the route (key gate, no-contact audit, insert+alert, dedup no-second-alert).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ audits: [] as Record<string, unknown>[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        h.audits.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));
vi.mock("@/lib/marketing/leadIntake", () => ({ upsertMarketingLead: vi.fn() }));
vi.mock("@/lib/whatsapp/opsAlert", () => ({
  sendOpsAlert: vi.fn(async () => ({ sent: true, attempts: 1 })),
  OPS_ALERT_TARGET_DIGITS: "919760059900",
}));

import { GET } from "@/app/api/leads/justdial/route";
import { upsertMarketingLead } from "@/lib/marketing/leadIntake";
import { sendOpsAlert } from "@/lib/whatsapp/opsAlert";
import { buildJdNotes, buildJdOpsAlert, mapJdCategory } from "@/lib/marketing/justdial";

const call = (qs: string) => GET(new Request(`http://x/api/leads/justdial?${qs}`));

describe("mapJdCategory", () => {
  it("maps JD categories to service_intent (nursing→medic_home, etc.)", () => {
    expect(mapJdCategory("Home Nursing Services")).toBe("medic_home");
    expect(mapJdCategory("Patient Attendant")).toBe("gda");
    expect(mapJdCategory("Elderly Caretaker")).toBe("gda");
    expect(mapJdCategory("Lab / Diagnostic at home")).toBe("lab");
    expect(mapJdCategory("Doctor consultation")).toBe("teleconsult");
    expect(mapJdCategory("Something else")).toBe("medic_home"); // fallback
    expect(mapJdCategory("")).toBe("medic_home");
  });
});

describe("buildJdNotes / buildJdOpsAlert", () => {
  const fields = {
    leadid: "T1",
    prefix: "Mr",
    name: "Test",
    category: "Home Nursing",
    area: "Kalkaji",
    city: "Delhi",
    pincode: "110019",
    phone: "9999988888",
  };
  it("notes carry the JD# marker + category + location", () => {
    expect(buildJdNotes(fields)).toBe("JD#T1 | Home Nursing | Kalkaji, Delhi 110019");
  });
  it("ops alert maps to a conversation-less lead alert", () => {
    const a = buildJdOpsAlert(fields);
    expect(a.conversationId).toBeNull();
    expect(a.patientName).toBe("Mr Test");
    expect(a.serviceDisplay).toBe("Home Nursing");
    expect(a.location).toBe("Kalkaji, Delhi 110019");
    expect(a.patientMobile).toBe("9999988888");
  });
});

describe("GET /api/leads/justdial", () => {
  beforeEach(() => {
    process.env.JD_LEAD_PUSH_KEY = "secretkey";
    h.audits = [];
    vi.mocked(upsertMarketingLead).mockReset();
    vi.mocked(sendOpsAlert).mockReset();
    vi.mocked(sendOpsAlert).mockResolvedValue({ sent: true, attempts: 1 });
  });
  afterEach(() => {
    delete process.env.JD_LEAD_PUSH_KEY;
  });

  it("wrong key → 403, no insert", async () => {
    const res = await call("key=wrong&leadid=T1&mobile=9999988888");
    expect(res.status).toBe(403);
    expect(upsertMarketingLead).not.toHaveBeenCalled();
  });

  it("env unset → 403 (fail closed)", async () => {
    delete process.env.JD_LEAD_PUSH_KEY;
    const res = await call("key=whatever&leadid=T1&mobile=9999988888");
    expect(res.status).toBe(403);
  });

  it("no phone AND no email → 200 SUCCESS, audits, no insert (no retry storm)", async () => {
    const res = await call("key=secretkey&leadid=JUNK&category=Nursing");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("SUCCESS");
    expect(upsertMarketingLead).not.toHaveBeenCalled();
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({ event_type: "jd_lead_no_contact" });
  });

  it("valid lead (created) → inserts source=justdial + service_intent + notes, does NOT ping ops (Lead Engine P1)", async () => {
    vi.mocked(upsertMarketingLead).mockResolvedValue({ lead: { id: "ml-1" } as never, created: true, error: null });
    const res = await call(
      "key=secretkey&leadid=T1&prefix=Mr&name=Test&mobile=%2B91%2099999%2088888&category=Home%20Nursing%20Services&area=Kalkaji&city=Delhi&pincode=110019",
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("SUCCESS");
    const arg = vi.mocked(upsertMarketingLead).mock.calls[0][0];
    expect(arg).toMatchObject({
      source: "justdial",
      campaign: "jd_listing",
      service_intent: "medic_home",
      consent_status: "pending",
    });
    expect(arg.contact.phone).toBe("9999988888"); // normalized last-10
    expect(arg.notes).toContain("JD#T1");
    // Founder re-architecture 2026-07-16: ingest hands off to the Aarogya
    // engagement sweep; ops is pinged ONLY on a qualified lead, never on ingest.
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });

  it("repeat push (deduped, created=false) → 200, still no ops ping", async () => {
    vi.mocked(upsertMarketingLead).mockResolvedValue({ lead: { id: "ml-1" } as never, created: false, error: null });
    const res = await call("key=secretkey&leadid=T1&name=Test&mobile=9999988888&category=Nursing");
    expect(res.status).toBe(200);
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });

  it("created lead → 200 SUCCESS and ops is never pinged at ingest", async () => {
    vi.mocked(upsertMarketingLead).mockResolvedValue({ lead: { id: "ml-2" } as never, created: true, error: null });
    const res = await call("key=secretkey&leadid=T2&name=X&mobile=9812345678&category=Lab");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("SUCCESS");
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });

  it("upsert failure → still 200 (logged, no retry storm)", async () => {
    vi.mocked(upsertMarketingLead).mockResolvedValue({ lead: null, created: false, error: "db down" });
    const res = await call("key=secretkey&leadid=T3&name=X&mobile=9812345678");
    expect(res.status).toBe(200);
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });
});
