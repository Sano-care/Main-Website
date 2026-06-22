// Slice 5b — cron endpoints: CRON_SECRET gate + sweep invocation.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/whatsapp/carehubOutbound", () => ({
  runCarehubOfferSweep: vi.fn(async () => ({ ran: false, considered: 0, sent: 0, blocked: 0, failed: 0 })),
}));
vi.mock("@/lib/whatsapp/carehubReminder", () => ({
  runCarehubReminderSweep: vi.fn(async () => ({
    ran: false, considered: 0, sent: 0, skippedAlreadySent: 0, skippedVisitBooked: 0, blocked: 0, failed: 0,
  })),
}));

import { POST as offerPOST } from "@/app/api/cron/carehub-offer/route";
import { POST as reminderPOST } from "@/app/api/cron/carehub-reminder/route";
import { runCarehubOfferSweep } from "@/lib/whatsapp/carehubOutbound";
import { runCarehubReminderSweep } from "@/lib/whatsapp/carehubReminder";

const SECRET = "s3cr3t-cron";
const url = "http://localhost/api/cron/x";

function req(headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", headers });
}

const origSecret = process.env.CRON_SECRET;
beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  vi.mocked(runCarehubOfferSweep).mockClear();
  vi.mocked(runCarehubReminderSweep).mockClear();
});
afterEach(() => {
  if (origSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = origSecret;
});

describe("cron secret gate", () => {
  it("500 + no sweep when CRON_SECRET is unset on the server", async () => {
    delete process.env.CRON_SECRET;
    const res = await offerPOST(req({ "x-cron-secret": SECRET }));
    expect(res.status).toBe(500);
    expect(vi.mocked(runCarehubOfferSweep)).not.toHaveBeenCalled();
  });

  it("401 + no sweep when the header is missing", async () => {
    const res = await offerPOST(req());
    expect(res.status).toBe(401);
    expect(vi.mocked(runCarehubOfferSweep)).not.toHaveBeenCalled();
  });

  it("401 + no sweep when the header is wrong", async () => {
    const res = await offerPOST(req({ "x-cron-secret": "nope" }));
    expect(res.status).toBe(401);
    expect(vi.mocked(runCarehubOfferSweep)).not.toHaveBeenCalled();
  });

  it("200 + runs offer sweep with the correct secret", async () => {
    const res = await offerPOST(req({ "x-cron-secret": SECRET }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, sweep: "carehub-offer", ran: false });
    expect(vi.mocked(runCarehubOfferSweep)).toHaveBeenCalledTimes(1);
  });

  it("200 + runs reminder sweep with the correct secret", async () => {
    const res = await reminderPOST(req({ "x-cron-secret": SECRET }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, sweep: "carehub-reminder" });
    expect(vi.mocked(runCarehubReminderSweep)).toHaveBeenCalledTimes(1);
  });
});
