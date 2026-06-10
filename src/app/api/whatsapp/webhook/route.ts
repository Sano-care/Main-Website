// POST /api/whatsapp/webhook — inbound WhatsApp Cloud API events.
// GET  /api/whatsapp/webhook — Meta subscription verification challenge.
//
// Deliverable 1. Contract (architecture §9.1, handover):
//   * GET: echo hub.challenge iff hub.mode=subscribe and hub.verify_token
//     matches WHATSAPP_VERIFY_TOKEN; otherwise 403.
//   * POST: verify X-Hub-Signature-256 HMAC over the RAW body; reject with 401
//     on failure (no message persisted, audit row written). On success, parse
//     + process, return 200.
//
// Latency: Week-1 per-message work is a few awaited DB calls + 1-2 Cloud
// API/Slack fetches — well under the 5s budget — so we process INLINE before
// returning 200. This is deliberate: backgrounding the work (e.g. next/server
// `after()`) on a serverless host risks dropping a life-critical emergency
// Slack alert if the platform freezes the function post-response. A real queue
// (Inngest/Trigger.dev) replaces this in Week 2 when LLM latency is added.
// See decisions.md.

import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/whatsapp/webhook-signature";
import { processWebhook } from "@/lib/whatsapp/adapter";
import { AuditEvent, writeAudit } from "@/lib/whatsapp/safety/audit";
import { WebhookEnvelopeSchema } from "@/types/whatsapp";
import { log } from "@/lib/whatsapp/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET — webhook verification handshake.
// ---------------------------------------------------------------------------
export function GET(req: NextRequest): NextResponse {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (
    mode === "subscribe" &&
    token &&
    process.env.WHATSAPP_VERIFY_TOKEN &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    log.info("webhook verification succeeded");
    // Meta expects the raw challenge string, 200, text/plain.
    return new NextResponse(challenge ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  log.warn("webhook verification failed", `mode=${mode}`);
  return new NextResponse("Forbidden", { status: 403 });
}

// ---------------------------------------------------------------------------
// POST — inbound events.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Read the RAW body exactly once — HMAC must be computed over these bytes.
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  const verdict = verifyWebhookSignature(
    rawBody,
    signature,
    process.env.WHATSAPP_APP_SECRET,
  );
  if (!verdict.valid) {
    log.error("signature verification failed", verdict.reason);
    // Audit the rejected attempt (no message is persisted). Best-effort.
    await writeAudit({
      conversationId: null,
      eventType: AuditEvent.SIGNATURE_VERIFICATION_FAILED,
      eventData: { reason: verdict.reason, had_signature: Boolean(signature) },
    });
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // Parse + validate. A signed-but-malformed payload is logged and 200'd (a
  // 4xx would make Meta retry a body that will never validate).
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    log.warn("signed payload was not valid JSON");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const result = WebhookEnvelopeSchema.safeParse(parsed);
  if (!result.success) {
    log.warn("signed payload failed schema validation");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Process inline (see latency note above), then 200.
  try {
    await processWebhook(result.data);
  } catch (err) {
    // Should not happen — processWebhook swallows per-message errors — but a
    // 200 is still correct so Meta doesn't hammer us with retries.
    log.error("webhook processing error", err);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
