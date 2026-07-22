// Aarogya durable turn queue — the decouple between "receive" and "process".
//
// The webhook does only fast, must-not-lose work synchronously (persist inbound,
// emergency/opt-out) then ENQUEUES the LLM turn here and returns 200. A worker
// (the drain cron / the immediate kick) claims + processes turns with retries,
// so a serverless timeout or an LLM hiccup is retried, never silently dropped.
//
// Serverless-safe debounce (no setTimeout/after()): a text turn is a single
// coalescing row per conversation whose `run_after` is pushed out by the
// debounce window on each new message, so a rapid burst merges into ONE turn
// when it finally drains. Media turns are per-message (coalescing once dropped a
// 2nd image) and due immediately. All atomicity lives in SQL (SECURITY DEFINER
// RPCs in migration 20260722072456) — this module is a thin, typed wrapper.

import { supabaseAdmin } from "@/lib/supabase-server";
import { log } from "@/lib/whatsapp/log";
import type { NormalizedInbound } from "@/types/whatsapp";

/** Default debounce (ms) before a text turn becomes due. Env-tunable. */
export const DEFAULT_TURN_DEBOUNCE_MS = 6000;

export function turnDebounceMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Number(env.AAROGYA_TURN_DEBOUNCE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_TURN_DEBOUNCE_MS;
}

/** Is async (queue-based) processing enabled? Default OFF — inline path stays. */
export function asyncProcessingEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.AAROGYA_ASYNC_PROCESSING === "true";
}

export type TurnKind = "text" | "media";

/** Media (image/document) processes per-message; everything else coalesces. */
export function kindForInbound(inbound: NormalizedInbound): TurnKind {
  return inbound.type === "image" || inbound.type === "document"
    ? "media"
    : "text";
}

export interface AarogyaTurnRow {
  id: string;
  conversation_id: string;
  message_id: string | null;
  phone: string;
  kind: TurnKind;
  payload: NormalizedInbound;
  status: "pending" | "processing" | "done" | "failed";
  run_after: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Enqueue an LLM turn for a persisted inbound message. Idempotent-friendly:
 * text turns coalesce onto the conversation's active row. Returns the queue row
 * id, or null on failure (the caller must NOT lose the message — a null here
 * means the reconciliation watchdog will re-enqueue from the conversation
 * timestamps, since the inbound is already persisted).
 */
export async function enqueueTurn(args: {
  conversationId: string;
  messageId: string | null;
  inbound: NormalizedInbound;
  debounceMs?: number;
}): Promise<string | null> {
  const kind = kindForInbound(args.inbound);
  const debounceMs = args.debounceMs ?? turnDebounceMs();
  const { data, error } = await supabaseAdmin.rpc("enqueue_aarogya_turn", {
    p_conversation_id: args.conversationId,
    p_message_id: args.messageId,
    p_phone: args.inbound.phone,
    p_kind: kind,
    p_payload: args.inbound as unknown as Record<string, unknown>,
    // Media is due immediately regardless of the text debounce window.
    p_debounce_ms: kind === "media" ? 0 : debounceMs,
  });
  if (error) {
    log.error("enqueueTurn failed", error.message);
    return null;
  }
  return (data as string) ?? null;
}

/**
 * Atomically claim the next due turn whose conversation has no turn already in
 * flight (per-conversation serialization). Returns null when nothing is due.
 */
export async function claimNextTurn(): Promise<AarogyaTurnRow | null> {
  const { data, error } = await supabaseAdmin.rpc("claim_next_aarogya_turn");
  if (error) {
    log.error("claimNextTurn failed", error.message);
    return null;
  }
  // The RPC returns a row whose columns are all NULL when nothing is claimable.
  const row = (Array.isArray(data) ? data[0] : data) as AarogyaTurnRow | null;
  return row && row.id ? row : null;
}

/** Mark a claimed turn done (and collapse sibling coalesced text rows). */
export async function completeTurn(id: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc("complete_aarogya_turn", {
    p_id: id,
  });
  if (error) log.error("completeTurn failed", id, error.message);
}

/**
 * Return a failed turn to the queue for retry (or mark 'failed' once attempts
 * are exhausted — the reconciliation watchdog is the last backstop). Returns
 * the resulting status.
 */
export async function failTurn(
  id: string,
  errorMessage: string,
): Promise<"pending" | "failed" | null> {
  const { data, error } = await supabaseAdmin.rpc("fail_aarogya_turn", {
    p_id: id,
    p_error: errorMessage,
  });
  if (error) {
    log.error("failTurn failed", id, error.message);
    return null;
  }
  return (data as "pending" | "failed") ?? null;
}

/** Hand rows stuck in 'processing' (worker died mid-turn) back to the drain. */
export async function requeueStuckTurns(
  olderThanSeconds = 180,
): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc(
    "requeue_stuck_aarogya_turns",
    { p_older_than_seconds: olderThanSeconds },
  );
  if (error) {
    log.error("requeueStuckTurns failed", error.message);
    return 0;
  }
  return (data as number) ?? 0;
}
