// Media + vision foundation — fetchInboundMedia guards + mediaRefFromRaw.

import { describe, expect, it, vi } from "vitest";
import {
  fetchInboundMedia,
  mediaRefFromRaw,
  MAX_MEDIA_BYTES,
} from "@/lib/whatsapp/media";

const env = { WHATSAPP_ACCESS_TOKEN: "tok", WHATSAPP_API_VERSION: "v21.0" };

function res(init: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  bytes?: Uint8Array;
}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => init.json,
    arrayBuffer: async () => (init.bytes ?? new Uint8Array()).buffer,
  } as unknown as Response;
}

describe("fetchInboundMedia", () => {
  it("no token → fails closed", async () => {
    const out = await fetchInboundMedia("m1", { env: {}, fetchImpl: vi.fn() });
    expect(out).toEqual({ ok: false, reason: "no_access_token" });
  });

  it("happy path: metadata then bytes, returns mime + bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res({ json: { url: "https://dl/x", mime_type: "image/jpeg", file_size: 3 } }))
      .mockResolvedValueOnce(res({ bytes }));
    const out = await fetchInboundMedia("m1", { env, fetchImpl });
    expect(out).toEqual({ ok: true, bytes, mimeType: "image/jpeg" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // First call authed to the media-id endpoint.
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/v21.0/m1");
  });

  it("rejects a disallowed mime without downloading", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res({ json: { url: "https://dl/x", mime_type: "image/gif" } }));
    const out = await fetchInboundMedia("m1", { env, fetchImpl });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("mime_not_allowed");
    expect(fetchImpl).toHaveBeenCalledTimes(1); // never downloaded
  });

  it("rejects oversize from metadata", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res({ json: { url: "https://dl/x", mime_type: "image/png", file_size: MAX_MEDIA_BYTES + 1 } }));
    const out = await fetchInboundMedia("m1", { env, fetchImpl });
    expect(out).toEqual({ ok: false, reason: "too_large" });
  });

  it("rejects oversize from actual bytes (metadata lied / absent)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res({ json: { url: "https://dl/x", mime_type: "application/pdf" } }))
      .mockResolvedValueOnce(res({ bytes: new Uint8Array(MAX_MEDIA_BYTES + 1) }));
    const out = await fetchInboundMedia("m1", { env, fetchImpl });
    expect(out).toEqual({ ok: false, reason: "too_large_actual" });
  });

  it("metadata HTTP error → reason", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(res({ ok: false, status: 404 }));
    const out = await fetchInboundMedia("m1", { env, fetchImpl });
    expect(out).toEqual({ ok: false, reason: "meta_http_404" });
  });
});

describe("mediaRefFromRaw", () => {
  it("extracts image id + mime", () => {
    expect(mediaRefFromRaw({ type: "image", image: { id: "i1", mime_type: "image/jpeg" } })).toEqual({
      mediaId: "i1",
      mime: "image/jpeg",
    });
  });
  it("extracts document id", () => {
    expect(mediaRefFromRaw({ type: "document", document: { id: "d1" } })).toEqual({
      mediaId: "d1",
      mime: null,
    });
  });
  it("null for text / missing id", () => {
    expect(mediaRefFromRaw({ type: "text" })).toBeNull();
    expect(mediaRefFromRaw({ type: "image", image: {} })).toBeNull();
  });
});
