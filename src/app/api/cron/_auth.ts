import { timingSafeEqual } from "node:crypto";

/**
 * Shared guard for cron-triggered endpoints. The caller (a scheduler, or the
 * founder running a manual smoke test) must present the CRON_SECRET in the
 * `x-cron-secret` header. Fails closed: if CRON_SECRET is unset/empty on the
 * server, NO request is ever authorized.
 *
 * Returns null when authorized, or a Response (401/500) to return as-is.
 */
export function checkCronSecret(req: Request): Response | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Misconfiguration — refuse rather than run unguarded.
    return Response.json(
      { error: "CRON_SECRET not configured." },
      { status: 500 },
    );
  }
  const provided = req.headers.get("x-cron-secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
}
