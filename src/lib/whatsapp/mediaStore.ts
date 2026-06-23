// Aarogya media + vision foundation — private storage + retention ledger.
//
// Used ONLY by consumers that persist media (selfie verification, document
// vault — separate PRs). The patient photo-ack consumer is storage-light and
// never calls these. All objects go to PRIVATE buckets (ap-south-1); access is
// via short-lived signed URLs. Every persisted object is recorded in the
// media_assets ledger so purgeExpiredMedia() can reclaim it.

import { supabaseAdmin } from "@/lib/supabase-server";
import { log } from "@/lib/whatsapp/log";

type SupabaseLike = typeof supabaseAdmin;

export interface StoreMediaArgs {
  bucket: string;
  path: string;
  bytes: Uint8Array;
  mimeType: string;
  /** Meta media id, recorded for provenance. */
  mediaId: string;
  ownerId?: string | null;
  /** When the asset becomes eligible for purge. null = keep until deleted. */
  purgeAfter?: Date | null;
}

export interface StoreMediaResult {
  ok: boolean;
  bucket: string;
  path: string;
  error?: string;
}

export async function storeMedia(
  args: StoreMediaArgs,
  deps: { supabase?: SupabaseLike } = {},
): Promise<StoreMediaResult> {
  const supabase = deps.supabase ?? supabaseAdmin;

  const { error: upErr } = await supabase.storage
    .from(args.bucket)
    .upload(args.path, args.bytes, {
      contentType: args.mimeType,
      upsert: false,
    });
  if (upErr) {
    log.error("storeMedia: upload failed", upErr.message);
    return { ok: false, bucket: args.bucket, path: args.path, error: "upload_failed" };
  }

  const { error: ledgerErr } = await supabase.from("media_assets").insert({
    media_id: args.mediaId,
    owner_id: args.ownerId ?? null,
    bucket: args.bucket,
    path: args.path,
    mime: args.mimeType,
    purge_after: args.purgeAfter ? args.purgeAfter.toISOString() : null,
  });
  if (ledgerErr) {
    // The object is uploaded but unrecorded — remove it so we don't leak an
    // un-purgeable asset, then report failure.
    log.error("storeMedia: ledger insert failed; rolling back object", ledgerErr.message);
    await supabase.storage.from(args.bucket).remove([args.path]).catch(() => {});
    return { ok: false, bucket: args.bucket, path: args.path, error: "ledger_failed" };
  }

  return { ok: true, bucket: args.bucket, path: args.path };
}

const DEFAULT_SIGNED_TTL_SECONDS = 60 * 60; // 1 hour

export async function signedUrl(
  bucket: string,
  path: string,
  ttlSeconds: number = DEFAULT_SIGNED_TTL_SECONDS,
  deps: { supabase?: SupabaseLike } = {},
): Promise<string | null> {
  const supabase = deps.supabase ?? supabaseAdmin;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, ttlSeconds);
  if (error) {
    log.error("signedUrl failed", error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

export interface PurgeResult {
  scanned: number;
  removed: number;
}

/**
 * Delete every media_assets row whose purge_after is in the past, along with
 * its storage object. Best-effort: a storage-remove failure still deletes the
 * ledger row (the object becomes orphaned but the ledger stays truthful — an
 * ops sweep can reconcile). Cron wiring is deferred to consumers.
 */
export async function purgeExpiredMedia(
  now: Date = new Date(),
  deps: { supabase?: SupabaseLike } = {},
): Promise<PurgeResult> {
  const supabase = deps.supabase ?? supabaseAdmin;

  const { data, error } = await supabase
    .from("media_assets")
    .select("id, bucket, path")
    .lt("purge_after", now.toISOString());
  if (error) {
    log.error("purgeExpiredMedia: select failed", error.message);
    return { scanned: 0, removed: 0 };
  }

  const rows = (data ?? []) as Array<{ id: string; bucket: string; path: string }>;
  if (rows.length === 0) return { scanned: 0, removed: 0 };

  // Group object paths by bucket for batched removes.
  const byBucket = new Map<string, string[]>();
  for (const r of rows) {
    const list = byBucket.get(r.bucket) ?? [];
    list.push(r.path);
    byBucket.set(r.bucket, list);
  }
  for (const [bucket, paths] of byBucket) {
    const { error: rmErr } = await supabase.storage.from(bucket).remove(paths);
    if (rmErr) log.error("purgeExpiredMedia: storage remove failed", bucket, rmErr.message);
  }

  const ids = rows.map((r) => r.id);
  const { error: delErr } = await supabase.from("media_assets").delete().in("id", ids);
  if (delErr) {
    log.error("purgeExpiredMedia: ledger delete failed", delErr.message);
    return { scanned: rows.length, removed: 0 };
  }

  return { scanned: rows.length, removed: rows.length };
}
