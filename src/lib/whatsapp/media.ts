// Aarogya media + vision foundation — inbound WhatsApp media fetch.
//
// fetchInboundMedia(mediaId) resolves a Meta Cloud API media id to its bytes:
//   1. GET {GRAPH}/{version}/{media_id}  → { url, mime_type, file_size } (authed)
//   2. GET that url                       → the raw bytes (also authed — Graph media
//                                            URLs require the access token)
//
// Guards: mime allowlist (jpeg/png/pdf), 5 MB size cap (checked from the
// metadata AND the actual byte length), and a hard request timeout. Returns a
// discriminated result and never throws, so callers degrade gracefully.

const GRAPH_BASE = "https://graph.facebook.com";

export const MAX_MEDIA_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_MEDIA_MIME = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);
const FETCH_TIMEOUT_MS = 10_000;

export type InboundMedia =
  | { ok: true; bytes: Uint8Array; mimeType: string }
  | { ok: false; reason: string };

export interface FetchMediaDeps {
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable env for tests. */
  env?: Record<string, string | undefined>;
}

export async function fetchInboundMedia(
  mediaId: string,
  deps: FetchMediaDeps = {},
): Promise<InboundMedia> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const token = env.WHATSAPP_ACCESS_TOKEN;
  if (!token) return { ok: false, reason: "no_access_token" };
  if (!mediaId) return { ok: false, reason: "no_media_id" };
  const apiVersion = env.WHATSAPP_API_VERSION ?? "v21.0";
  const auth = { Authorization: `Bearer ${token}` };

  // Step 1 — resolve the media id to a download URL + metadata.
  let meta: { url?: string; mime_type?: string; file_size?: number };
  try {
    const res = await withTimeout(fetchImpl, `${GRAPH_BASE}/${apiVersion}/${encodeURIComponent(mediaId)}`, { headers: auth });
    if (!res.ok) return { ok: false, reason: `meta_http_${res.status}` };
    meta = (await res.json()) as typeof meta;
  } catch {
    return { ok: false, reason: "meta_fetch_failed" };
  }

  const mimeType = (meta.mime_type ?? "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_MEDIA_MIME.has(mimeType)) {
    return { ok: false, reason: `mime_not_allowed:${mimeType || "unknown"}` };
  }
  if (typeof meta.file_size === "number" && meta.file_size > MAX_MEDIA_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  if (!meta.url) return { ok: false, reason: "no_download_url" };

  // Step 2 — download the bytes (Graph media URLs require the token too).
  try {
    const res = await withTimeout(fetchImpl, meta.url, { headers: auth });
    if (!res.ok) return { ok: false, reason: `download_http_${res.status}` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0) return { ok: false, reason: "empty" };
    if (bytes.byteLength > MAX_MEDIA_BYTES) return { ok: false, reason: "too_large_actual" };
    return { ok: true, bytes, mimeType };
  } catch {
    return { ok: false, reason: "download_failed" };
  }
}

async function withTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the (mediaId, mime) pair off a raw inbound message for image/document
 *  types. Returns null for anything else. The webhook schema is `.passthrough()`,
 *  so these fields are present at runtime though not in the typed shape. */
export function mediaRefFromRaw(
  raw: unknown,
): { mediaId: string; mime: string | null } | null {
  const m = raw as {
    type?: string;
    image?: { id?: string; mime_type?: string };
    document?: { id?: string; mime_type?: string };
  };
  const node = m?.type === "image" ? m.image : m?.type === "document" ? m.document : null;
  if (!node?.id) return null;
  return { mediaId: node.id, mime: node.mime_type ?? null };
}
