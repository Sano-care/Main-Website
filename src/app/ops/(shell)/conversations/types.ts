// Aarogya conversation viewer — shared types + pure helpers (no DB, no React,
// so they're safe to import from server (data.ts), client components, AND tests).

export type ConvFilter =
  | "all"
  | "active"
  | "escalated"
  | "emergency"
  | "errors"
  | "optout";

export const FILTERS: { key: ConvFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active 24h" },
  { key: "escalated", label: "Escalated" },
  { key: "emergency", label: "Emergency" },
  { key: "errors", label: "Errors" },
  { key: "optout", label: "Opt-out" },
];

export interface ConversationRow {
  id: string;
  phone: string;
  state: string;
  serviceIntent: string | null;
  escalationStatus: string;
  optOut: boolean;
  /** ISO timestamp of the most recent activity (msg in/out or row creation). */
  lastActivityAt: string;
  /** Within the 24h active window — computed server-side at fetch time so the
   *  client never calls Date.now() during render (keeps render pure). */
  isActive: boolean;
  /** Pre-rendered relative-time label ("5m" / "2h" / "3d"), also server-baked. */
  timeSinceLabel: string;
  lastMessage: { direction: "inbound" | "outbound"; content: string } | null;
  messageCount: number;
  hasEmergency: boolean;
  hasEscalation: boolean;
  hasError: boolean;
}

export interface MessageItem {
  kind: "message";
  id: string;
  direction: "inbound" | "outbound";
  content: string;
  contentType: string;
  model: string | null;
  tokensOut: number | null;
  createdAt: string;
  /** ops_media.id for a stored inbound image/document, viewable via
   *  /api/ops/media/[id]. null = none stored or already purged (>3 days). */
  opsMediaId: string | null;
  /** 'image' | 'document' when an ops-media item exists. */
  mediaKind: string | null;
  // For content_type === "location" the loader parses raw_payload.location
  // server-side (parseLocation) and surfaces the coords here. Null for every
  // other message type — and for a location whose coords are missing or
  // non-numeric, so the bubble falls back to the plain "[location]" text.
  // Coords are floats.
  latitude: number | null;
  longitude: number | null;
  locationName: string | null;
  locationAddress: string | null;
}

export interface AuditItem {
  kind: "audit";
  id: string;
  eventType: string;
  eventData: Record<string, unknown>;
  createdAt: string;
}

export type ThreadItem = MessageItem | AuditItem;

export interface ConversationMeta {
  id: string;
  phone: string;
  state: string;
  serviceIntent: string | null;
  escalationStatus: string;
  optOut: boolean;
  firstSeenAt: string;
  messageCount: number;
  totalTokensOut: number;
  modelsUsed: string[];
}

// Audit events hidden from the thread overlay — they 1:1 duplicate the
// message bubbles and would just be noise.
export const HIDDEN_AUDIT_TYPES = new Set([
  "agent_response",
  "message_received",
  "message_echoed",
]);

export const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** True if the conversation's last activity is within the 24h active window.
 *  Called server-side (data.ts) with the request-time `now`. */
export function isWithinActiveWindow(lastActivityAt: string, now: number): boolean {
  return now - new Date(lastActivityAt).getTime() < ACTIVE_WINDOW_MS;
}

/** Compact relative-time label. Called server-side so render stays pure. */
export function relativeTime(iso: string, now: number): string {
  const m = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Filter predicate — shared by the live counts and the rendered list.
 *  The time-relative "active" case reads the server-baked `isActive` flag,
 *  so this stays a pure function of its inputs. */
export function matchesFilter(c: ConversationRow, filter: ConvFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "active":
      return c.isActive;
    case "escalated":
      return c.hasEscalation || c.escalationStatus !== "none";
    case "emergency":
      return c.hasEmergency;
    case "errors":
      return c.hasError;
    case "optout":
      return c.optOut;
  }
}

/** Case-insensitive search over phone digits + last-message content. */
export function matchesSearch(c: ConversationRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const phoneDigits = c.phone.replace(/\D/g, "");
  if (phoneDigits.includes(q.replace(/\D/g, "")) && q.replace(/\D/g, "")) return true;
  if (c.phone.toLowerCase().includes(q)) return true;
  if (c.lastMessage?.content.toLowerCase().includes(q)) return true;
  return false;
}

/**
 * Mask the middle digits of an Indian number for screenshot-safe display:
 * "+91 98765 43210" -> "+91xxxxxx3210". Keeps the country code + last 4.
 */
export function redactPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "+91xxxxxx____";
  return `+91xxxxxx${digits.slice(-4)}`;
}

/** Tel-link form: strip to digits, ensure +91 country code. */
export function telHref(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("91") ? `tel:+${d}` : `tel:+91${d}`;
}

// ── Location rendering (patient-shared map pins) ────────────────────────────
// A WhatsApp location message stores its coords in messages.raw_payload as
// `{ location: { latitude, longitude, name?, address? } }`. The loader parses
// it server-side; the bubble renders a Google Maps link. Pure (no DB, no React)
// so it's safe to import from data.ts, the client bubble, and the tests.

export interface ParsedLocation {
  latitude: number;
  longitude: number;
  /** Present only for named-place shares; null for a raw pin. */
  name: string | null;
  address: string | null;
}

/** Accept a finite number, or a non-empty numeric string; reject everything
 *  else (null/undefined/boolean/object/"" → null). Guards against 0,0 from a
 *  Number(null)/Number("") coercion and keeps the Maps URL injection-safe (the
 *  output is always a finite number, never raw user text). */
function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Parse a WhatsApp location payload into validated coords. Returns null for a
 * non-location payload or one whose latitude/longitude is missing or
 * non-numeric — the caller then falls back to the plain "[location]" text.
 */
export function parseLocation(rawPayload: unknown): ParsedLocation | null {
  if (!rawPayload || typeof rawPayload !== "object") return null;
  const loc = (rawPayload as Record<string, unknown>).location;
  if (!loc || typeof loc !== "object") return null;
  const l = loc as Record<string, unknown>;

  const latitude = toFiniteNumber(l.latitude);
  const longitude = toFiniteNumber(l.longitude);
  if (latitude === null || longitude === null) return null;

  const name = typeof l.name === "string" && l.name.trim() ? l.name : null;
  const address = typeof l.address === "string" && l.address.trim() ? l.address : null;
  return { latitude, longitude, name, address };
}

/** Google Maps "search" deep link for a coordinate pair (opens the location).
 *  Caller must pass finite numbers (see parseLocation / Number.isFinite gate). */
export function mapsSearchUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}
