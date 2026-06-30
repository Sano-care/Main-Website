// /ops/marketing must be ops-admin-gated. The page calls requireOpsAdmin BEFORE
// any data fetch (belt-and-suspenders with the (shell) layout's gate).

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireOpsAdmin, fetchAttribution } = vi.hoisted(() => ({
  requireOpsAdmin: vi.fn(),
  fetchAttribution: vi.fn(),
}));

vi.mock("@/app/ops/_lib/requireOpsAdmin", () => ({ requireOpsAdmin }));
vi.mock("@/lib/marketing/attribution", () => ({ fetchAttribution }));

import Page from "@/app/ops/(shell)/marketing/page";

const sp = (o: Record<string, string> = {}) => Promise.resolve(o);
const emptyTotals = {
  source: "TOTAL",
  campaign: "",
  leads: 0,
  qualified: 0,
  hot: 0,
  booked: 0,
  revenue_paise: 0,
  spend_paise: 0,
  cac_paise: null,
  roas: null,
  conv_rate: null,
};

beforeEach(() => {
  requireOpsAdmin.mockReset();
  fetchAttribution.mockReset();
});

describe("/ops/marketing auth gate", () => {
  it("non-admin → requireOpsAdmin redirects (throws) BEFORE any data fetch", async () => {
    requireOpsAdmin.mockRejectedValue(new Error("REDIRECT:/ops/no-access"));
    await expect(Page({ searchParams: sp() })).rejects.toThrow(/REDIRECT/);
    expect(requireOpsAdmin).toHaveBeenCalledTimes(1);
    expect(fetchAttribution).not.toHaveBeenCalled();
  });

  it("admin → passes the gate and fetches attribution for the requested range", async () => {
    requireOpsAdmin.mockResolvedValue({ role: "admin" });
    fetchAttribution.mockResolvedValue({
      rows: [],
      totals: emptyTotals,
      range: { from: "2026-06-01", to: "2026-06-30" },
      spendPresent: false,
      latestSpendDate: null,
    });
    await Page({ searchParams: sp({ from: "2026-06-01", to: "2026-06-30" }) });
    expect(requireOpsAdmin).toHaveBeenCalled();
    expect(fetchAttribution).toHaveBeenCalledWith({ from: "2026-06-01", to: "2026-06-30" });
  });
});
