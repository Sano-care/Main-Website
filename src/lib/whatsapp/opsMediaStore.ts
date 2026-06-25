// Aarogya — ops media store: persist inbound chat media for ops viewing + purge.
//
// The SINGLE registry/writer for ops-viewable inbound media (customer WhatsApp +
// the medic attendance selfie, which the Dev side registers via the same
// persistInboundOpsMedia with sender_role='medic'). Files go to the private
// ops-media bucket; the purge cron deletes them after purge_after.
//
// This is the EPHEMERAL ops-viewing copy. It NEVER touches the pulse_documents
// vault or any clinical bucket — purgeExpiredOpsMedia operates on ops-media only.

import { supabaseAdmin } from "@/lib/supabase-server";
import { AuditEvent, writeAudit } from "@/lib/whatsapp/safety/audit";
import { log } from "@/lib/whatsapp/log";

export const OPS_MEDIA_BUCKET = "ops-media";
/** customer chat media = 3 days; medic selfie = 72h — both 72h. */
export const DEFAULT_RETENTION_HOURS = 72;

type SupabaseLike = typeof supabaseAdmin;

function extFor(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

export interface PersistOpsMediaArgs {
  /** messages.id FK (nullable — medic-app selfie may have no chat message). */
  messageId: string | null;
  conversationId: string;
  /** 'customer' | 'medic' | … */
  senderRole: string;
  mediaKind: "image" | "document";
  /** Meta media_id (provenance). */
  mediaId: string;
  bytes: Uint8Array;
  mimeType: string;
  now?: Date;
  /** TTL hours; default 72 (customer 3d / medic 72h). */
  retentionHours?: number;
  /** Deterministic object id for tests. */
  objectId?: string;
}

export interface PersistOpsMediaResult {
  ok: boolean;
  opsMediaId?: string;
  filePath?: string;
  error?: string;
}

export async function persistInboundOpsMedia(
  args: PersistOpsMediaArgs,
  deps: { supabase?: SupabaseLike; writeAuditFn?: typeof writeAudit; randomId?: () => string } = {},
): Promise<PersistOpsMediaResult> {
  const supabase = deps.supabase ?? supabaseAdmin;
  const writeAuditFn = deps.writeAuditFn ?? writeAudit;
  const randomId = deps.randomId ?? (() => globalThis.crypto.randomUUID());
  const now = args.now ?? new Date();
  const retentionHours = args.retentionHours ?? DEFAULT_RETENTION_HOURS;
  const purgeAfter = new Date(now.getTime() + retentionHours * 3600 * 1000);
  const objectId = args.objectId ?? randomId();
  const filePath = `${args.conversationId}/${objectId}.${extFor(args.mimeType)}`;

  const { error: upErr } = await supabase.storage
    .from(OPS_MEDIA_BUCKET)
    .upload(filePath, args.bytes, { contentType: args.mimeType, upsert: false });
  if (upErr) {
    log.error("persistInboundOpsMedia: upload failed", upErr.message);
    return { ok: false, error: "upload_failed" };
  }

  const { data, error: insErr } = await supabase
    .from("ops_media")
    .insert({
      message_id: args.messageId,
      conversation_id: args.conversationId,
      sender_role: args.senderRole,
      media_kind: args.mediaKind,
      media_id: args.mediaId,
      file_path: filePath,
      mime_type: args.mimeType,
      size_bytes: args.bytes.byteLength,
      received_at: now.toISOString(),
      purge_after: purgeAfter.toISOString(),
    })
    .select("id")
    .single();
  if (insErr || !data) {
    // Roll back the orphaned object.
    log.error("persistInboundOpsMedia: insert failed; rolling back object", insErr?.message);
    await supabase.storage.from(OPS_MEDIA_BUCKET).remove([filePath]).catch(() => {});
    return { ok: false, error: "insert_failed" };
  }
  const opsMediaId = (data as { id: string }).id;

  await writeAuditFn({
    conversationId: args.conversationId,
    eventType: AuditEvent.OPS_MEDIA_STORED,
    eventData: {
      ops_media_id: opsMediaId,
      sender_role: args.senderRole,
      media_kind: args.mediaKind,
      purge_after: purgeAfter.toISOString(),
    },
  });

  return { ok: true, opsMediaId, filePath };
}

export interface PurgeResult {
  scanned: number;
  purged: number;
}

/**
 * Delete the ops-media object + soft-delete the row for every ops_media whose
 * purge_after is in the past and which isn't already deleted. Touches ONLY the
 * ops-media bucket / ops_media table — never pulse-documents, medic-documents,
 * lab-reports, prescriptions, or the pulse_documents vault.
 */
export async function purgeExpiredOpsMedia(
  now: Date = new Date(),
  deps: { supabase?: SupabaseLike; writeAuditFn?: typeof writeAudit } = {},
): Promise<PurgeResult> {
  const supabase = deps.supabase ?? supabaseAdmin;
  const writeAuditFn = deps.writeAuditFn ?? writeAudit;

  const { data, error } = await supabase
    .from("ops_media")
    .select("id, file_path")
    .lt("purge_after", now.toISOString())
    .is("deleted_at", null);
  if (error) {
    log.error("purgeExpiredOpsMedia: select failed", error.message);
    return { scanned: 0, purged: 0 };
  }
  const rows = (data ?? []) as Array<{ id: string; file_path: string }>;
  if (rows.length === 0) return { scanned: 0, purged: 0 };

  const paths = rows.map((r) => r.file_path);
  const { error: rmErr } = await supabase.storage.from(OPS_MEDIA_BUCKET).remove(paths);
  if (rmErr) log.error("purgeExpiredOpsMedia: object remove failed", rmErr.message);

  const ids = rows.map((r) => r.id);
  const { error: updErr } = await supabase
    .from("ops_media")
    .update({ deleted_at: now.toISOString() })
    .in("id", ids);
  if (updErr) {
    log.error("purgeExpiredOpsMedia: soft-delete failed", updErr.message);
    return { scanned: rows.length, purged: 0 };
  }

  await writeAuditFn({
    eventType: AuditEvent.OPS_MEDIA_PURGED,
    eventData: { count: rows.length }, // count only, never paths/content
  });
  return { scanned: rows.length, purged: rows.length };
}
