import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/pulse/documents/[docId]/signed-url
//
// Patient-facing signed-URL minter for a Pulse vault document. Mirrors the
// medic-documents route (T65 Phase 2B): write a DPDP access-log row with
// SHA256(ip + salt) — never raw IP — BEFORE minting the URL. Best-effort: a
// failed log insert does NOT block the download (an audit miss is preferable to
// denying a patient their own document).
//
// Ownership is the security boundary: requirePulseCustomer resolves the customer
// from the session, and we only mint a URL when the document's customer_id
// matches. A doc id belonging to another account 404s. Identity never comes from
// input.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SIGNED_URL_TTL_SECONDS = 600;
const PULSE_DOCS_BUCKET = "pulse-documents";

function hashIp(ip: string): string {
  // Same construction as the medic route: SHA256(ip|DPDP_IP_SALT). The salt
  // keeps the hash out of reach of a rainbow table; a missing env falls back to
  // a constant so the audit trail still records *something* non-reversible.
  const salt = process.env.DPDP_IP_SALT ?? "sanocare-dpdp-fallback-salt";
  return createHash("sha256").update(`${ip}|${salt}`).digest("hex");
}

function readClientIp(req: NextRequest): string {
  const nf = req.headers.get("x-nf-client-connection-ip");
  if (nf) return nf;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ docId: string }> },
) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  const { docId } = await params;
  if (!UUID_RE.test(docId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  // Resolve the doc + confirm it belongs to THIS customer and isn't soft-deleted.
  const { data: doc, error: docErr } = await supabaseAdmin
    .from("pulse_documents")
    .select("id, customer_id, file_path, deleted_at")
    .eq("id", docId)
    .maybeSingle();
  if (docErr) {
    console.error("[pulse/doc-signed-url] lookup failed", docErr);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  // 404 for both "missing" and "not yours" — don't leak the existence of
  // another account's document.
  if (!doc || doc.customer_id !== customer.id) {
    return NextResponse.json({ error: "doc_not_found" }, { status: 404 });
  }
  if (doc.deleted_at) {
    return NextResponse.json({ error: "doc_deleted" }, { status: 410 });
  }

  // DPDP audit — insert FIRST, then mint. accessor encodes the patient channel.
  const ip = readClientIp(req);
  const { error: logErr } = await supabaseAdmin
    .from("pulse_document_access_log")
    .insert({
      doc_id: docId,
      accessor: `pulse:${customer.id}`,
      ip_hash: hashIp(ip),
    });
  if (logErr) {
    console.error("[pulse/doc-signed-url] access log insert failed (proceeding)", logErr);
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from(PULSE_DOCS_BUCKET)
    .createSignedUrl(doc.file_path, SIGNED_URL_TTL_SECONDS);
  if (signErr || !signed?.signedUrl) {
    console.error("[pulse/doc-signed-url] mint failed", signErr);
    return NextResponse.json(
      { error: "mint_failed", detail: signErr?.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    url: signed.signedUrl,
    expires_at: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
  });
}
