// Slice 2b — typed WhatsApp send errors + classification.
//
// Replaces the single generic "outbound_send_failed" path with errors that
// carry the Meta Cloud API error code/subcode/fbtrace_id and, crucially, a
// retry policy. The sender (sender.ts) retries ONLY TransientSendError.
//
// Classification rules (HTTP status + Meta error code/subcode):
//   Permanent (do NOT retry): 400, 401, 403, 404; Meta codes 190 + the
//     100 / 131xx / 132xxx / 133xxx auth/template families; subcodes 33,
//     2494007. Unknown also → Permanent (fail loud, never retry blind).
//   Transient (retry w/ backoff): 408, 429 (→ RateLimitedError), 500–504,
//     524; network/DNS/TLS errors; Meta codes 1, 2, 4.

export class WhatsAppSendError extends Error {
  /** HTTP status, when the failure was an HTTP response. */
  readonly status?: number;
  /** Meta error.code. */
  readonly code?: number;
  /** Meta error.error_subcode. */
  readonly subcode?: number;
  /** Meta error.fbtrace_id — the support handle for a given failure. */
  readonly fbtraceId?: string;
  /** Human-readable reason the classifier chose this class. */
  readonly classification: string;

  constructor(
    message: string,
    opts: {
      status?: number;
      code?: number;
      subcode?: number;
      fbtraceId?: string;
      classification?: string;
    } = {},
  ) {
    super(message);
    this.name = "WhatsAppSendError";
    this.status = opts.status;
    this.code = opts.code;
    this.subcode = opts.subcode;
    this.fbtraceId = opts.fbtraceId;
    this.classification = opts.classification ?? "unspecified";
  }
}

/** Terminal — retrying will not help. */
export class PermanentSendError extends WhatsAppSendError {
  constructor(message: string, opts: ConstructorParameters<typeof WhatsAppSendError>[1] = {}) {
    super(message, opts);
    this.name = "PermanentSendError";
  }
}

/** Retryable with backoff. */
export class TransientSendError extends WhatsAppSendError {
  constructor(message: string, opts: ConstructorParameters<typeof WhatsAppSendError>[1] = {}) {
    super(message, opts);
    this.name = "TransientSendError";
  }
}

/** 429 / explicit rate limit. Carries the server's Retry-After hint. */
export class RateLimitedError extends TransientSendError {
  /** Seconds to wait before retrying, from the Retry-After header. */
  readonly retryAfter?: number;
  constructor(
    message: string,
    opts: ConstructorParameters<typeof WhatsAppSendError>[1] & { retryAfter?: number } = {},
  ) {
    super(message, opts);
    this.name = "RateLimitedError";
    this.retryAfter = opts.retryAfter;
  }
}

// Meta error codes that are permanent regardless of HTTP status.
const PERMANENT_META_CODES = new Set([190]); // expired/invalid access token
// Meta error codes that are transient (rate/temporary/internal).
const TRANSIENT_META_CODES = new Set([1, 2, 4]); // API unknown/service/too-many-calls
const PERMANENT_SUBCODES = new Set([33, 2494007]);

const TRANSIENT_HTTP = new Set([408, 429, 500, 501, 502, 503, 504, 524]);
const PERMANENT_HTTP = new Set([400, 401, 403, 404]);

/** True for the 100 / 131xx / 132xxx / 133xxx auth+template families. */
function isPermanentMetaFamily(code?: number): boolean {
  if (code === undefined) return false;
  if (code === 100) return true;
  if (code >= 13100 && code <= 13199) return true; // 131xx
  if (code >= 132000 && code <= 132999) return true; // 132xxx
  if (code >= 133000 && code <= 133999) return true; // 133xxx
  return false;
}

export interface ClassifyInput {
  status?: number;
  code?: number;
  subcode?: number;
  fbtraceId?: string;
  retryAfter?: number;
  /** True when the failure was a network/DNS/TLS error (no HTTP response). */
  network?: boolean;
  message?: string;
}

/**
 * Map an HTTP status + Meta error code/subcode to a typed error. Network
 * errors are transient; anything unrecognised is Permanent (fail loud).
 */
export function classifySendError(input: ClassifyInput): WhatsAppSendError {
  const { status, code, subcode, fbtraceId, retryAfter, network } = input;
  const base = { status, code, subcode, fbtraceId };
  const msg = input.message ?? `send failed (status=${status ?? "-"} code=${code ?? "-"})`;

  // 1. Network/DNS/TLS — transient.
  if (network) {
    return new TransientSendError(msg, { ...base, classification: "network_error" });
  }

  // 2. Subcode overrides (e.g. 33 invalid param, 2494007).
  if (subcode !== undefined && PERMANENT_SUBCODES.has(subcode)) {
    return new PermanentSendError(msg, { ...base, classification: `permanent_subcode_${subcode}` });
  }

  // 3. Rate limit — 429 always; transient.
  if (status === 429) {
    return new RateLimitedError(msg, { ...base, retryAfter, classification: "http_429" });
  }

  // 4. Permanent Meta code families (auth/template) regardless of status.
  if (PERMANENT_META_CODES.has(code as number) || isPermanentMetaFamily(code)) {
    return new PermanentSendError(msg, { ...base, classification: `permanent_meta_code_${code}` });
  }

  // 5. Transient Meta codes.
  if (code !== undefined && TRANSIENT_META_CODES.has(code)) {
    return new TransientSendError(msg, { ...base, classification: `transient_meta_code_${code}` });
  }

  // 6. HTTP status buckets.
  if (status !== undefined && TRANSIENT_HTTP.has(status)) {
    return new TransientSendError(msg, { ...base, classification: `transient_http_${status}` });
  }
  if (status !== undefined && PERMANENT_HTTP.has(status)) {
    return new PermanentSendError(msg, { ...base, classification: `permanent_http_${status}` });
  }

  // 7. Unknown → Permanent (never retry blind).
  return new PermanentSendError(msg, { ...base, classification: "unknown_treated_permanent" });
}
