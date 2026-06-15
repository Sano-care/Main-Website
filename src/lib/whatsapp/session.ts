// Slice 2b — WhatsApp 24h customer-service window check.
//
// Meta only permits free-form (non-template) sends within 24h of the user's
// last inbound message. db.ts stamps `conversations.last_user_msg_at` on every
// inbound, so the window check is a single column read — no scan of `messages`.
//
// Fails CLOSED for free-form intent: if we can't prove the window is open
// (missing timestamp, DB error), treat the session as expired so the caller
// falls back to a template rather than risking a policy violation / 131047.

import { supabaseAdmin } from "@/lib/supabase-server";
import { log } from "@/lib/whatsapp/log";

export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface SessionWindow {
  open: boolean;
  lastUserMsgAt: string | null;
  ageMs: number | null;
}

/**
 * Is the conversation still inside the 24h free-form window? `nowMs` is
 * injectable for tests.
 */
export async function getSessionWindow(
  conversationId: string,
  nowMs: number = Date.now(),
): Promise<SessionWindow> {
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select("last_user_msg_at")
    .eq("id", conversationId)
    .maybeSingle();

  if (error || !data) {
    log.error("session window read failed (failing closed)", error?.message);
    return { open: false, lastUserMsgAt: null, ageMs: null };
  }

  const lastUserMsgAt = (data.last_user_msg_at as string | null) ?? null;
  if (!lastUserMsgAt) {
    return { open: false, lastUserMsgAt: null, ageMs: null };
  }

  const ageMs = nowMs - new Date(lastUserMsgAt).getTime();
  return { open: ageMs >= 0 && ageMs < SESSION_WINDOW_MS, lastUserMsgAt, ageMs };
}

/** Convenience boolean wrapper. */
export async function isWithinSessionWindow(
  conversationId: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  return (await getSessionWindow(conversationId, nowMs)).open;
}
