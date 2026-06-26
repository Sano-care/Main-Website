import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// ── Mocks for the route's seams ────────────────────────────────────────────
vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  customer: { id: "cust-1" } as { id: string } | null,
  memberLookup: { data: null as { id: string } | null, error: null as unknown },
  core: {
    ok: true,
    documentId: "doc-1",
    docType: "other",
    sizeBytes: 4,
    reason: undefined as string | undefined,
  },
  auditCalls: [] as Record<string, unknown>[],
  coreCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/app/pulse/_lib/requireCustomer", () => ({
  requirePulseCustomer: vi.fn(async () =>
    h.customer
      ? { customer: h.customer }
      : { response: new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }) },
  ),
}));

vi.mock("@/lib/pulse/documentVault", () => ({
  vaultDocumentBytes: vi.fn(async (args: Record<string, unknown>) => {
    h.coreCalls.push(args);
    return { ...h.core };
  }),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve(h.memberLookup),
          }),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/whatsapp/safety/audit", () => ({
  AuditEvent: { PULSE_VAULT_UPLOADED: "pulse_vault_uploaded" },
  writeAudit: vi.fn(async (e: Record<string, unknown>) => {
    h.auditCalls.push(e);
    return true;
  }),
}));

import { POST } from "./route";
import { vaultDocumentBytes } from "@/lib/pulse/documentVault";

function makeReq(parts: { file?: File | null; doc_type?: string; label?: string; member_id?: string }): NextRequest {
  const fd = new FormData();
  if (parts.file !== null) {
    fd.append(
      "file",
      parts.file ?? new File([new Uint8Array([1, 2, 3, 4])], "report.pdf", { type: "application/pdf" }),
    );
  }
  if (parts.doc_type !== undefined) fd.append("doc_type", parts.doc_type);
  if (parts.label !== undefined) fd.append("label", parts.label);
  if (parts.member_id !== undefined) fd.append("member_id", parts.member_id);
  return new Request("http://t/api/pulse/documents", { method: "POST", body: fd }) as unknown as NextRequest;
}

beforeEach(() => {
  h.customer = { id: "cust-1" };
  h.memberLookup = { data: null, error: null };
  h.core = { ok: true, documentId: "doc-1", docType: "other", sizeBytes: 4, reason: undefined };
  h.auditCalls = [];
  h.coreCalls = [];
  vi.clearAllMocks();
});

describe("POST /api/pulse/documents", () => {
  it("self upload → core(source='pulse_upload', customerId from session), audits, 201 metadata", async () => {
    const res = await POST(makeReq({ doc_type: "lab_report", label: "CBC June" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.document).toMatchObject({ id: "doc-1", member_id: null });

    expect(vaultDocumentBytes).toHaveBeenCalledTimes(1);
    expect(h.coreCalls[0]).toMatchObject({
      customerId: "cust-1",
      source: "pulse_upload",
      docType: "lab_report",
      memberId: null,
    });
    expect(h.auditCalls).toHaveLength(1);
    expect(h.auditCalls[0]).toMatchObject({
      eventType: "pulse_vault_uploaded",
      identity: { role: "customer", identifiers: { customer_id: "cust-1" } },
    });
    // phone-free
    expect(JSON.stringify(h.auditCalls[0])).not.toMatch(/\+?\d{10,}/);
  });

  it("missing file → 400, core never called", async () => {
    const res = await POST(makeReq({ file: null }));
    expect(res.status).toBe(400);
    expect(vaultDocumentBytes).not.toHaveBeenCalled();
  });

  it("disallowed mime → 400, core never called", async () => {
    const gif = new File([new Uint8Array([1])], "x.gif", { type: "image/gif" });
    const res = await POST(makeReq({ file: gif }));
    expect(res.status).toBe(400);
    expect(vaultDocumentBytes).not.toHaveBeenCalled();
  });

  it("oversize → 400, core never called", async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" });
    const res = await POST(makeReq({ file: big }));
    expect(res.status).toBe(400);
    expect(vaultDocumentBytes).not.toHaveBeenCalled();
  });

  it("IDOR — member_id not on this customer → 400, core never called", async () => {
    h.memberLookup = { data: null, error: null }; // lookup finds nothing
    const res = await POST(makeReq({ member_id: "someone-elses-member" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/family member isn't on your account/i);
    expect(vaultDocumentBytes).not.toHaveBeenCalled();
  });

  it("member_id that IS on this customer → core called with that memberId", async () => {
    h.memberLookup = { data: { id: "mem-9" }, error: null };
    const res = await POST(makeReq({ member_id: "mem-9" }));
    expect(res.status).toBe(201);
    expect(h.coreCalls[0]).toMatchObject({ memberId: "mem-9", customerId: "cust-1" });
  });

  it("unauthenticated → the 401 from requirePulseCustomer", async () => {
    h.customer = null;
    const res = await POST(makeReq({}));
    expect(res.status).toBe(401);
    expect(vaultDocumentBytes).not.toHaveBeenCalled();
  });

  it("core failure (upload/insert) → 500, no audit", async () => {
    h.core = { ok: false, documentId: undefined as unknown as string, docType: "other", sizeBytes: 4, reason: "insert_failed" };
    const res = await POST(makeReq({}));
    expect(res.status).toBe(500);
    expect(h.auditCalls).toHaveLength(0);
  });
});
