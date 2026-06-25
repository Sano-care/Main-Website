import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOpsAdminApi } from "@/app/ops/_lib/requireOpsAdmin";
import { AuditEvent, writeAudit } from "@/lib/whatsapp/safety/audit";
import { OPS_MEDIA_BUCKET } from "@/lib/whatsapp/opsMediaStore";

export const runtime = "nodejs";

// GET /api/ops/media/[id] — ops-only inline view of an inbound chat-media item
// (customer photo/PDF or medic selfie). Mirrors the medic-doc signed-URL route:
// ops-admin gate → short-lived (600s) signed URL on the PRIVATE ops-media bucket
// → 302 redirect so it renders inline in /ops/conversations. A purged/missing row
// returns 410 so the viewer shows the "expired" placeholder. Never public.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNED_URL_TTL_SECONDS = 600;

function hashIp(ip: string): string {
  const salt = process.env.DPDP_IP_SALT ?? "sanocare-dpdp-fallback-salt";
  return createHash("sha256").update(`${ip}|${salt}`).digest("hex");
}
function readClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-nf-client-connection-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireOpsAdminApi();
  if (gate instanceof NextResponse) return gate; // 401/403 — ops-only

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("ops_media")
    .select("id, conversation_id, file_path, mime_type, deleted_at")
    .eq("id", id)
    .maybeSingle();
  const row = data as
    | { id: string; conversation_id: string; file_path: string; mime_type: string; deleted_at: string | null }
    | null;

  if (error || !row || row.deleted_at) {
    // Purged or never stored → the viewer shows "media expired (not retained
    // beyond 3 days)".
    return NextResponse.json({ error: "media expired or not retained" }, { status: 410 });
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from(OPS_MEDIA_BUCKET)
    .createSignedUrl(row.file_path, SIGNED_URL_TTL_SECONDS);
  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({ error: "could not sign" }, { status: 500 });
  }

  // DPDP audit (best-effort) — who viewed which item, hashed IP, never raw.
  await writeAudit({
    conversationId: row.conversation_id,
    eventType: AuditEvent.OPS_MEDIA_VIEWED,
    eventData: { ops_media_id: row.id, ip_hash: hashIp(readClientIp(req)) },
  });

  return NextResponse.redirect(signed.signedUrl, 302);
}
