// Open-redirect guard for the ?next= bounce used by the (authed) layout → login.
//
// Only same-origin, Pulse-scoped paths are honoured. Anything else (absolute
// URLs, protocol-relative "//evil.com", non-/pulse paths) collapses to the
// Pulse home. Kept dependency-free so both the server page and the client
// form can import it.

const DEFAULT_NEXT = "/pulse";

export function sanitizeNext(next: string | null | undefined): string {
  if (!next) return DEFAULT_NEXT;
  // Must be a root-relative path, not protocol-relative ("//host") and not
  // an absolute URL ("https://", "javascript:", etc.).
  if (!next.startsWith("/") || next.startsWith("//")) return DEFAULT_NEXT;
  // Scope to the Pulse surface — login should never bounce into /ops,
  // /doctor, or arbitrary marketing routes.
  if (next !== "/pulse" && !next.startsWith("/pulse/")) return DEFAULT_NEXT;
  return next;
}
