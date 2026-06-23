// Conversation-quality hotfix — pure helpers (location parsing, debounce
// coalesce/dedupe, stalled-thread backstop, state advancement). Kept pure +
// dependency-free so they're exhaustively unit-testable; the adapter wires them
// to IO.

// ── C2: location ─────────────────────────────────────────────────────────────
export interface ParsedLocation {
  lat: number;
  lng: number;
  name: string | null;
  address: string | null;
}

/** Extract a location pin from a raw WhatsApp message (`.passthrough()` keeps
 *  `location` at runtime though it's not in the typed shape). Null unless both
 *  coordinates are present. */
export function locationFromRaw(raw: unknown): ParsedLocation | null {
  const loc = (raw as { location?: { latitude?: unknown; longitude?: unknown; name?: unknown; address?: unknown } })?.location;
  if (!loc || typeof loc.latitude !== "number" || typeof loc.longitude !== "number") {
    return null;
  }
  return {
    lat: loc.latitude,
    lng: loc.longitude,
    name: typeof loc.name === "string" && loc.name.trim() ? loc.name.trim() : null,
    address: typeof loc.address === "string" && loc.address.trim() ? loc.address.trim() : null,
  };
}

/** The structured note threaded into the agent turn so Aarogya acknowledges the
 *  pin and continues qualification (and can populate escalate_to_ops.location). */
export function synthesizeLocationText(loc: ParsedLocation): string {
  const place = loc.address ?? loc.name;
  return `[Patient shared their location pin: ${loc.lat},${loc.lng}${place ? ` (${place})` : ""}]`;
}

// ── C3: debounce / coalesce ──────────────────────────────────────────────────
/** Combine the texts of several unanswered inbound messages into one turn input
 *  (oldest → newest). Blank parts dropped. */
export function coalesceInboundText(parts: Array<string | null | undefined>): string {
  return parts.map((p) => (p ?? "").trim()).filter(Boolean).join("\n");
}

/** Aggressive normalize for near-duplicate detection: lowercase, strip
 *  non-alphanumerics, collapse spaces. "Sure, I can help!" ≈ "Sure I can help". */
export function normalizeReply(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True if `candidate` is a near-duplicate of any recent outbound reply. */
export function isDuplicateReply(candidate: string, recentOutbound: string[]): boolean {
  const n = normalizeReply(candidate);
  if (!n) return false;
  return recentOutbound.some((r) => normalizeReply(r) === n);
}

// ── C4: stalled-thread backstop ──────────────────────────────────────────────
export const STALLED_TURN_CAP = 12;

/** Deterministic backstop: auto-escalate ONCE when a thread loops past the cap
 *  without progress. Rate-limited by escalation_status (never re-fires once an
 *  escalation exists) and skipped when the model already escalated this turn. */
export function shouldAutoEscalateStalled(args: {
  turnCount: number;
  escalationStatus: string | null;
  escalatedThisTurn: boolean;
}): boolean {
  if (args.escalatedThisTurn) return false;
  if (args.escalationStatus === "requested" || args.escalationStatus === "complete") return false;
  return args.turnCount >= STALLED_TURN_CAP;
}

// ── C5: state advancement ────────────────────────────────────────────────────
// Matches the conversations.state CHECK ordering (greeting → … → escalated).
const STATE_ORDER = ["greeting", "triaging", "qualifying", "qualified", "escalated"];

/** Returns `target` only if it is strictly forward of `current` (so state never
 *  regresses, e.g. back to greeting); otherwise null = no write. Unknown states
 *  (cold/opted_out) never advance. */
export function nextState(current: string, target: string): string | null {
  const ci = STATE_ORDER.indexOf(current);
  const ti = STATE_ORDER.indexOf(target);
  if (ti === -1) return null;
  if (ci === -1) return null;
  return ti > ci ? target : null;
}
