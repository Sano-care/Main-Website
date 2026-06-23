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
// Pulse Records — Aarogya document vault (Slice C).
//
// uploadToPulseVault takes a document a patient JUST sent on WhatsApp (a lab
// report, prescription, scan, discharge summary) and files it into their
// private Pulse vault:
//   1. Identity gate — the customer is resolved from the adapter-injected
//      identity, NEVER from tool/model input. A non-customer is refused.
//   2. Pull the bytes from Meta (fetchInboundMedia), re-validating mime + size
//      against the pulse_documents whitelist (defence in depth).
//   3. Upload to the private India-region `pulse-documents` bucket.
//   4. Insert the pulse_documents metadata row (source='whatsapp_aarogya').
//   5. Upload-rollback: if the metadata insert fails, the just-uploaded object
//      is removed so we never orphan storage — mirrors the medic-documents
//      upload route exactly.
//   6. Audit (DPDP): one PULSE_VAULT_UPLOADED row, identity-aware, phone-free
//      (ids/types/size only — never the file contents).
//
// The bytes never touch the model; Aarogya only ever sees the confirmation
// string this returns.
// ---------------------------------------------------------------------------

const BUCKET = "pulse-documents";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — matches the bucket + CHECK cap.

// Intersection of what Meta lets us fetch (jpeg/png/pdf) and the
// pulse_documents mime whitelist (jpeg/png/webp/pdf).
const VAULT_MIME = new Set(["image/jpeg", "image/png", "application/pdf"]);
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

const DOC_TYPES = [
  "lab_report",
  "prescription",
  "imaging",
  "discharge_summary",
  "other",
] as const;
type DocType = (typeof DOC_TYPES)[number];

const NOT_A_CUSTOMER =
  "I can only save records once you have a Sanocare account — book a visit and I'll start keeping your reports here for you.";

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

function normalizeDocType(input: string | undefined): DocType {
  return (DOC_TYPES as readonly string[]).includes(input ?? "")
    ? (input as DocType)
    : "other";
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
  const supabase = deps.supabase ?? supabaseAdmin;
  const writeAuditFn = deps.writeAuditFn ?? writeAudit;
  const randomId = deps.randomId ?? (() => globalThis.crypto.randomUUID());

  const fetched = await fetchMedia(args.media.mediaId);
  if (!fetched.ok) {
    return {
      ok: false,
      message: "I couldn't pull that file in — could you resend it?",
      reason: `fetch_failed:${fetched.reason}`,
    };
  }
  const mime = fetched.mimeType;
  if (!VAULT_MIME.has(mime)) {
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

  const docType = normalizeDocType(args.docType);
  const ext = MIME_EXT[mime] ?? "bin";
  const path = `${customerId}/${docType}/${randomId()}.${ext}`;

  // Upload bytes. upsert:false so a path collision never overwrites.
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, fetched.bytes, { contentType: mime, upsert: false });
  if (upErr) {
    log.error("[pulse/vault] storage upload failed", upErr.message);
    return {
      ok: false,
      message: "I hit a snag saving that — let's try again in a moment.",
      reason: "upload_failed",
    };
  }

  // Insert metadata. customer_id ALWAYS from the resolved identity.
  const { data, error: insErr } = await supabase
    .from("pulse_documents")
    .insert({
      customer_id: customerId,
      member_id: args.memberId ?? null,
      doc_type: docType,
      file_path: path,
      file_size_bytes: fetched.bytes.byteLength,
      mime_type: mime,
      label: args.label ?? null,
      source: "whatsapp_aarogya",
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
    return {
      ok: false,
      message: "I hit a snag saving that — let's try again in a moment.",
      reason: "insert_failed",
    };
  }

  const auditIdentity: AuditIdentity = identityForAudit(args.identity);
  await writeAuditFn({
    conversationId: args.conversationId ?? null,
    eventType: AuditEvent.PULSE_VAULT_UPLOADED,
    identity: auditIdentity,
    eventData: {
      document_id: data.id,
      doc_type: docType,
      mime,
      size_bytes: fetched.bytes.byteLength,
      member_scoped: Boolean(args.memberId),
      source: "whatsapp_aarogya",
    },
  });

  const what = args.label?.trim() || DOC_TYPE_LABEL[docType];
  return {
    ok: true,
    documentId: data.id,
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
