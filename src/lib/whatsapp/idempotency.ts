// Slice 2b — outbound idempotency.
//
// Prevents the same logical message (same conversation + same content within
// the same minute) from being sent twice — e.g. a double-fired event, a
// serverless retry, or two senders racing. The key is content- and
// time-bucketed so genuinely distinct sends are never collapsed.
//
//   idempotency_key = sha256( conversation_id : sha256(content) : minuteBucket )
//   minuteBucket    = floor(nowMs / 60000)
//
// Before sending, the dispatcher looks for a `messages` row written in the
// last 5 minutes with the same key; if found it returns that row's
// provider_message_id and makes NO Cloud API call.

import { createHash } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase-server";
import { log } from "@/lib/whatsapp/log";

const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Deterministic key for a logical outbound message. `nowMs` is injectable for
 * tests; defaults to Date.now().
 */
export function computeIdempotencyKey(
  conversationId: string,
  content: string,
  nowMs: number = Date.now(),
): string {
  const minuteBucket = Math.floor(nowMs / 60_000);
  return sha256(`${conversationId}:${sha256(content)}:${minuteBucket}`);
}

export interface RecentDuplicate {
  providerMessageId: string | null;
  createdAt: string;
}

/**
 * Look for an outbound `messages` row with the same idempotency_key written in
 * the last 5 minutes. Returns the most recent match (its wamid) or null.
 *
 * Fails OPEN on a DB error (returns null) — losing dedupe is recoverable; the
 * worst case is a rare duplicate send, never a dropped legitimate message.
 */
export async function findRecentByIdempotencyKey(
  idempotencyKey: string,
  nowMs: number = Date.now(),
): Promise<RecentDuplicate | null> {
  const since = new Date(nowMs - DEDUPE_WINDOW_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("provider_message_id, created_at")
    .eq("idempotency_key", idempotencyKey)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    log.error("idempotency lookup failed (failing open)", error.message);
    return null;
  }
  if (!data) return null;
  return {
    providerMessageId: (data.provider_message_id as string | null) ?? null,
    createdAt: data.created_at as string,
  };
}
