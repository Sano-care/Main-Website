import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOpsAdminApi } from "@/app/ops/_lib/requireOpsAdmin";

export const runtime = "nodejs";

// T65 Phase 2B C4 — GET /api/ops/medics/[id]/docs/[docId]/signed-url
//
// Admin-only signed-URL minter for medic documents. DPDP-conscious audit
// trail: INSERTs a medic_doc_access_log row with SHA256(ip + salt) — never
// raw IP — BEFORE returning the URL. Best-effort: a failed log insert
// does NOT block download (an audit miss is preferable to a denied access
// for a legitimate admin pulling a doc).
//
// Signed URL TTL: 600 seconds (10 minutes). Long enough for ops to click
// and have the file open in a new tab even with a slow link; short enough
// that screenshotted URLs decay fast.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SIGNED_URL_TTL_SECONDS = 600;

function hashIp(ip: string): string {
  // SHA256(ip + DPDP_IP_SALT). Salt makes the hash non-rainbow-table-able
  // without knowing the secret. If salt env is missing, fall back to a
  // build-time constant so the audit trail still works (hashes are then
  // identical across deploys but still not reversible to an IP).
  const salt = process.env.DPDP_IP_SALT ?? "sanocare-dpdp-fallback-salt";
  return createHash("sha256").update(`${ip}|${salt}`).digest("hex");
}

function readClientIp(req: NextRequest): string {
  // Netlify forwards client IP via x-nf-client-connection-ip. Fall through
  // to standard x-forwarded-for (first hop) for other hosts.
  const nf = req.headers.get("x-nf-client-connection-ip");
  if (nf) return nf;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const adminGate = await requireOpsAdminApi();
  if (adminGate instanceof NextResponse) return adminGate;

  const { id: medicId, docId } = await params;
  if (!UUID_RE.test(medicId) || !UUID_RE.test(docId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  // Resolve the doc + verify it belongs to the medic in the URL AND
  // hasn't been soft-deleted. Soft-deleted docs can't be re-downloaded
  // (the row is still readable for audit history; the bytes are still
  // in Storage until cron purge, but we won't mint URLs for them).
  const { data: doc, error: docErr } = await supabaseAdmin
    .from("medic_documents")
    .select("id, medic_id, file_path, deleted_at")
    .eq("id", docId)
    .maybeSingle();
  if (docErr) {
    console.error("[signed-url] doc lookup failed", docErr);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!doc) {
    return NextResponse.json({ error: "doc_not_found" }, { status: 404 });
  }
  if (doc.medic_id !== medicId) {
    return NextResponse.json({ error: "doc_medic_mismatch" }, { status: 400 });
  }
  if (doc.deleted_at) {
    return NextResponse.json({ error: "doc_deleted" }, { status: 410 });
  }

  // DPDP audit — insert FIRST, then mint URL. If insert fails we log +
  // proceed (audit miss < access denial for legitimate use).
  const ip = readClientIp(request);
  const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;
  const { error: logErr } = await supabaseAdmin
    .from("medic_doc_access_log")
    .insert({
      doc_id: docId,
      accessed_by: adminGate.id,
      user_agent: userAgent,
      ip_hash: hashIp(ip),
    });
  if (logErr) {
    console.error("[signed-url] access log insert failed (proceeding)", logErr);
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from("medic-documents")
    .createSignedUrl(doc.file_path, SIGNED_URL_TTL_SECONDS);
  if (signErr || !signed?.signedUrl) {
    console.error("[signed-url] mint failed", signErr);
    return NextResponse.json(
      { error: "mint_failed", detail: signErr?.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    url: signed.signedUrl,
    expires_at: new Date(
      Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
    ).toISOString(),
  });
}
