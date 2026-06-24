// Pulse Documents — vault WRITE path.
//
// Slice A (#92) shipped the READ path (recordsFetch) + schema but NO writer.
// This is the first writer: upload to the private pulse-documents bucket +
// insert pulse_documents (service-role, code-level customer_id scoping) + a
// pulse_document_access_log row. Factored as a standalone helper so a future
// Pulse slice can adopt it as the canonical writer (rather than each consumer
// re-implementing the upload+insert+audit triad).
//
// Conventions mirror the read side exactly: bucket name, accessor format
// ('aarogya:{customer_id}'), and ip_hash = SHA256(ip|DPDP_IP_SALT).

import { createHash, randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import { log } from "@/lib/whatsapp/log";

const PULSE_DOCS_BUCKET = "pulse-documents";

type SupabaseLike = typeof supabaseAdmin;

/** SHA256(ip|salt) — same construction as the signed-url read route + medic
 *  route. Aarogya server-side filing has no patient HTTP request, so callers
 *  pass a stable sentinel (e.g. "aarogya-whatsapp"); accessor already encodes
 *  the channel. */
export function hashIp(ip: string): string {
  const salt = process.env.DPDP_IP_SALT ?? "sanocare-dpdp-fallback-salt";
  return createHash("sha256").update(`${ip}|${salt}`).digest("hex");
}

function extForMime(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  return "jpg";
}

export interface FileDocumentArgs {
  customerId: string;
  /** null = Self (per D2); a family_members.id otherwise. */
  memberId: string | null;
  docType: string;
  mimeType: string;
  bytes: Uint8Array;
  label?: string | null;
  /** Provenance — always 'aarogya' for this consumer. */
  source?: string;
  /** Sentinel/ip for the DPDP access log (server-side filing → sentinel). */
  ip?: string;
  /** Deterministic object id (tests inject; prod passes a uuid). */
  objectId?: string;
}

export interface FileDocumentResult {
  ok: boolean;
  docId?: string;
  filePath?: string;
  error?: string;
}

export async function fileDocumentToVault(
  args: FileDocumentArgs,
  deps: { supabase?: SupabaseLike } = {},
): Promise<FileDocumentResult> {
  const supabase = deps.supabase ?? supabaseAdmin;
  const source = args.source ?? "aarogya";
  const objectId = args.objectId ?? randomUUID();
  // Path is scoped under customer_id — the private bucket + this prefix are the
  // tenant boundary (mirrors how the read side scopes by customer_id).
  const filePath = `${args.customerId}/${objectId}.${extForMime(args.mimeType)}`;

  const { error: upErr } = await supabase.storage
    .from(PULSE_DOCS_BUCKET)
    .upload(filePath, args.bytes, { contentType: args.mimeType, upsert: false });
  if (upErr) {
    log.error("fileDocumentToVault: upload failed", upErr.message);
    return { ok: false, error: "upload_failed" };
  }

  const { data, error: insErr } = await supabase
    .from("pulse_documents")
    .insert({
      customer_id: args.customerId,
      member_id: args.memberId,
      doc_type: args.docType,
      file_path: filePath,
      file_size_bytes: args.bytes.byteLength,
      mime_type: args.mimeType,
      label: args.label ?? null,
      source,
    })
    .select("id")
    .single();
  if (insErr || !data) {
    // Roll back the orphaned object so we never leak an un-recorded file.
    log.error("fileDocumentToVault: insert failed; rolling back object", insErr?.message);
    await supabase.storage.from(PULSE_DOCS_BUCKET).remove([filePath]).catch(() => {});
    return { ok: false, error: "insert_failed" };
  }
  const docId = (data as { id: string }).id;

  // DPDP access log — best-effort; a failure here doesn't undo the stored doc.
  const { error: logErr } = await supabase.from("pulse_document_access_log").insert({
    doc_id: docId,
    accessor: `aarogya:${args.customerId}`,
    ip_hash: hashIp(args.ip ?? "aarogya-whatsapp"),
  });
  if (logErr) log.error("fileDocumentToVault: access log insert failed (non-fatal)", logErr.message);

  return { ok: true, docId, filePath };
}
