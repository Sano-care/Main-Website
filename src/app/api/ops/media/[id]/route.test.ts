// Ops media viewer route — auth gate + expired(410) + signed-URL redirect.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  gate: null as unknown, // NextResponse (deny) or an ops user (allow)
  row: null as Record<string, unknown> | null,
  signed: { data: { signedUrl: "https://signed/x" }, error: null } as unknown,
}));

vi.mock("@/app/ops/_lib/requireOpsAdmin", () => ({
  requireOpsAdminApi: vi.fn(async () => h.gate),
}));
vi.mock("@/lib/whatsapp/safety/audit", async (orig) => {
  const actual = await orig<typeof import("@/lib/whatsapp/safety/audit")>();
  return { ...actual, writeAudit: vi.fn(async () => true) };
});
vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.row, error: null }) }) }) }),
    storage: { from: () => ({ createSignedUrl: async () => h.signed }) },
  },
}));

import { GET } from "./route";

const UUID = "11111111-2222-3333-4444-555555555555";
const req = () => new Request(`http://localhost/api/ops/media/${UUID}`) as never;
const params = Promise.resolve({ id: UUID });

beforeEach(() => {
  h.gate = { id: "ops-1" };
  h.row = { id: UUID, conversation_id: "c1", file_path: "c1/x.jpg", mime_type: "image/jpeg", deleted_at: null };
});

describe("GET /api/ops/media/[id]", () => {
  it("non-ops → returns the auth gate's response (refused)", async () => {
    h.gate = NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const res = await GET(req(), { params });
    expect(res.status).toBe(401);
  });

  it("ops + live row → 302 redirect to a short-lived signed URL", async () => {
    const res = await GET(req(), { params });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://signed/x");
  });

  it("purged (deleted_at set) → 410 expired", async () => {
    h.row = { ...(h.row as object), deleted_at: "2026-06-27T00:00:00Z" } as Record<string, unknown>;
    const res = await GET(req(), { params });
    expect(res.status).toBe(410);
  });

  it("missing row → 410 expired", async () => {
    h.row = null;
    const res = await GET(req(), { params });
    expect(res.status).toBe(410);
  });

  it("bad id → 400", async () => {
    const res = await GET(req(), { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(res.status).toBe(400);
  });
});
