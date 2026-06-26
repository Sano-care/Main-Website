import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { fetchInboundMedia, type InboundMedia } from "@/lib/whatsapp/media";
import {
  AuditEvent,
  writeAudit,
  type AuditIdentity,
} from "@/lib/whatsapp/safety/audit";
import { identityForAudit, type Identity } from "@/lib/whatsapp/identity";
import { log } from "@/lib/whatsapp/log";

// ---------------------------------------------------------------------------
// Pulse Records — document vault (the ONE pulse_documents writer).
//
// `vaultDocumentBytes` is the shared core: given RAW BYTES + a resolved
// customer, it validates (mime + size) → uploads to the private India-region
// `pulse-documents` bucket → inserts the metadata row → rolls the orphaned
// object back if the insert fails → returns the document id. It takes NO
// identity and writes NO audit, so it serves both entry points:
//   - Web (Pulse session): POST /api/pulse/documents passes the multipart
//     bytes + customer.id + source='pulse_upload', then writes its own audit.
//   - WhatsApp (Aarogya):  `uploadToPulseVault` (below) gates on the
//     adapter-injected Identity, fetches the bytes from Meta, calls the core
//     with source='whatsapp_aarogya', then writes its own audit + returns the
//     patient-facing confirmation. Behaviour is unchanged by the extraction.
//
// The bytes never touch the model and are never logged (DPDP).
// ---------------------------------------------------------------------------

const BUCKET = "pulse-documents";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — matches the bucket + CHECK cap.

// The pulse_documents mime whitelist (DB CHECK). webp is valid on the table;
// it only never arrives over WhatsApp because Meta can't hand us webp (see the
// narrower VAULT_MIME set the wrapper pre-checks).
const VAULT_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

// What Meta lets Aarogya fetch (jpeg/png/pdf) — the WhatsApp wrapper pre-checks
// against this so it can give the patient a WhatsApp-shaped message; the core's
// fuller VAULT_MIME set is the authoritative gate (and the only one webp hits).
const WHATSAPP_FETCHABLE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

const DOC_TYPES = [
  "lab_report",
  "prescription",
  "imaging",
  "discharge_summary",
  "other",
] as const;
type DocType = (typeof DOC_TYPES)[number];

/** Mirrors the pulse_documents.source CHECK. */
export type VaultSource = "whatsapp_aarogya" | "pulse_upload";

const NOT_A_CUSTOMER =
  "I can only save records once you have a Sanocare account — book a visit and I'll start keeping your reports here for you.";

function normalizeDocType(input: string | undefined): DocType {
  return (DOC_TYPES as readonly string[]).includes(input ?? "")
    ? (input as DocType)
    : "other";
}

// ===========================================================================
// Shared core — RAW BYTES → pulse_documents (no identity, no audit, no message)
// ===========================================================================

export interface VaultDocumentBytesArgs {
  /** Resolved server-side (session customer, or Aarogya identity) — never trusted from input. */
  customerId: string;
  bytes: Uint8Array;
  mimeType: string;
  docType?: string;
  label?: string | null;
  memberId?: string | null;
  source: VaultSource;
}

export interface VaultCoreDeps {
  supabase?: typeof supabaseAdmin;
  /** Injectable id generator (tests pass a deterministic one). */
  randomId?: () => string;
}

export interface VaultCoreResult {
  ok: boolean;
  documentId?: string;
  /** Normalised doc_type actually stored (callers reuse it for audit/UI). */
  docType: DocType;
  sizeBytes: number;
  /** Machine reason on failure: mime_not_allowed | too_large | upload_failed | insert_failed. */
  reason?: string;
}

/**
 * Validate → upload → insert → (rollback on insert failure). The single place
 * that writes a pulse_documents row + its storage object. Returns a machine
 * result; the caller owns the audit + any user-facing message.
 */
export async function vaultDocumentBytes(
  args: VaultDocumentBytesArgs,
  deps: VaultCoreDeps = {},
): Promise<VaultCoreResult> {
  const supabase = deps.supabase ?? supabaseAdmin;
  const randomId = deps.randomId ?? (() => globalThis.crypto.randomUUID());

  const docType = normalizeDocType(args.docType);
  const sizeBytes = args.bytes.byteLength;

  if (!VAULT_MIME.has(args.mimeType)) {
    return { ok: false, reason: `mime_not_allowed:${args.mimeType}`, docType, sizeBytes };
  }
  if (sizeBytes <= 0) {
    return { ok: false, reason: "empty", docType, sizeBytes };
  }
  if (sizeBytes > MAX_BYTES) {
    return { ok: false, reason: "too_large", docType, sizeBytes };
  }

  const ext = MIME_EXT[args.mimeType] ?? "bin";
  const path = `${args.customerId}/${docType}/${randomId()}.${ext}`;

  // Upload bytes. upsert:false so a path collision never overwrites.
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, args.bytes, { contentType: args.mimeType, upsert: false });
  if (upErr) {
    log.error("[pulse/vault] storage upload failed", upErr.message);
    return { ok: false, reason: "upload_failed", docType, sizeBytes };
  }

  // Insert metadata. customer_id ALWAYS server-resolved (passed in).
  const { data, error: insErr } = await supabase
    .from("pulse_documents")
    .insert({
      customer_id: args.customerId,
      member_id: args.memberId ?? null,
      doc_type: docType,
      file_path: path,
      file_size_bytes: sizeBytes,
      mime_type: args.mimeType,
      label: args.label ?? null,
      source: args.source,
    })
    .select("id")
    .single();

  if (insErr || !data) {
    // Roll back the orphaned object — mirrors the medic-documents route.
    try {
      await supabase.storage.from(BUCKET).remove([path]);
    } catch (rbErr) {
      log.error("[pulse/vault] rollback remove failed", rbErr);
    }
    log.error("[pulse/vault] metadata insert failed; rolled back", insErr?.message);
    return { ok: false, reason: "insert_failed", docType, sizeBytes };
  }

  return { ok: true, documentId: data.id, docType, sizeBytes };
}

// ===========================================================================
// WhatsApp wrapper — Aarogya: identity gate + fetch Meta media → core + audit
// (Public signature unchanged from #97; behaviour must not change.)
// ===========================================================================

/** The inbound-media reference the adapter extracts via mediaRefFromRaw(). */
export interface VaultMediaRef {
  mediaId: string;
  mime: string | null;
}

export interface UploadToPulseVaultArgs {
  /** Adapter-injected. Customer id is taken from here, never from input. */
  identity: Identity;
  /** The document the patient just sent. Null when there's nothing attached. */
  media: VaultMediaRef | null;
  /** Best-guess category from what the patient said; defaults to 'other'. */
  docType?: string;
  /** Optional short human label, e.g. "CBC report June". */
  label?: string | null;
  /** Optional family-member id when the doc is about a member; else account holder. */
  memberId?: string | null;
  /** WhatsApp conversation id for the audit row. */
  conversationId?: string | null;
}

export interface UploadToPulseVaultDeps {
  fetchMedia?: (mediaId: string) => Promise<InboundMedia>;
  supabase?: typeof supabaseAdmin;
  writeAuditFn?: typeof writeAudit;
  /** Injectable id generator (tests pass a deterministic one). */
  randomId?: () => string;
}

export interface UploadResult {
  ok: boolean;
  message: string;
  documentId?: string;
  /** Machine reason for tests/logs; never shown to the patient. */
  reason?: string;
}

function customerIdOf(identity: Identity): string | null {
  if (identity.role !== "customer" || !("customerId" in identity) || !identity.customerId) {
    return null;
  }
  return identity.customerId;
}

export async function uploadToPulseVault(
  args: UploadToPulseVaultArgs,
  deps: UploadToPulseVaultDeps = {},
): Promise<UploadResult> {
  const customerId = customerIdOf(args.identity);
  if (!customerId) {
    return { ok: false, message: NOT_A_CUSTOMER, reason: "not_customer" };
  }
  if (!args.media?.mediaId) {
    return {
      ok: false,
      message:
        "I don't see a document just now — send me the report or prescription (a photo or PDF) and I'll save it to your records.",
      reason: "no_media",
    };
  }

  const fetchMedia = deps.fetchMedia ?? fetchInboundMedia;
  const writeAuditFn = deps.writeAuditFn ?? writeAudit;

  const fetched = await fetchMedia(args.media.mediaId);
  if (!fetched.ok) {
    return {
      ok: false,
      message: "I couldn't pull that file in — could you resend it?",
      reason: `fetch_failed:${fetched.reason}`,
    };
  }
  const mime = fetched.mimeType;
  if (!WHATSAPP_FETCHABLE_MIME.has(mime)) {
    return {
      ok: false,
      message: "I can save photos (JPG or PNG) or PDFs. That file type isn't one I can keep.",
      reason: `mime_not_allowed:${mime}`,
    };
  }
  if (fetched.bytes.byteLength > MAX_BYTES) {
    return {
      ok: false,
      message: "That file is a little too large to save (max 10 MB). A clearer single-page photo usually works.",
      reason: "too_large",
    };
  }

  // Delegate the upload + insert + rollback to the shared core.
  const core = await vaultDocumentBytes(
    {
      customerId,
      bytes: fetched.bytes,
      mimeType: mime,
      docType: args.docType,
      label: args.label,
      memberId: args.memberId,
      source: "whatsapp_aarogya",
    },
    { supabase: deps.supabase, randomId: deps.randomId },
  );

  if (!core.ok || !core.documentId) {
    // upload_failed / insert_failed (validation already short-circuited above).
    return {
      ok: false,
      message: "I hit a snag saving that — let's try again in a moment.",
      reason: core.reason ?? "save_failed",
    };
  }

  const auditIdentity: AuditIdentity = identityForAudit(args.identity);
  await writeAuditFn({
    conversationId: args.conversationId ?? null,
    eventType: AuditEvent.PULSE_VAULT_UPLOADED,
    identity: auditIdentity,
    eventData: {
      document_id: core.documentId,
      doc_type: core.docType,
      mime,
      size_bytes: core.sizeBytes,
      member_scoped: Boolean(args.memberId),
      source: "whatsapp_aarogya",
    },
  });

  const what = args.label?.trim() || DOC_TYPE_LABEL[core.docType];
  return {
    ok: true,
    documentId: core.documentId,
    message: `Saved to your records — ${what}. You'll find it anytime under "Your records" in Pulse. (I keep it safe; I don't read what's inside.)`,
  };
}

const DOC_TYPE_LABEL: Record<DocType, string> = {
  lab_report: "your lab report",
  prescription: "your prescription",
  imaging: "your scan",
  discharge_summary: "your discharge summary",
  other: "your document",
};
