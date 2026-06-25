import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import {
  HIDDEN_AUDIT_TYPES,
  isWithinActiveWindow,
  parseLocation,
  relativeTime,
  type AuditItem,
  type ConversationMeta,
  type ConversationRow,
  type MessageItem,
  type ThreadItem,
} from "./types";

// conversations / messages / audit_log are RLS deny-all (M035) — only the
// service-role client can read them. These functions are server-only and never
// reach the client (no Supabase secret crosses the boundary).

const LIST_LIMIT = 200;
// Bounds the message scan used to compute previews + counts for the list.
// At current scale this comfortably covers every message of the top-200
// conversations; paginate / move to an RPC aggregate if the corpus outgrows it.
const MESSAGE_SCAN_CAP = 5000;

// audit event_types that drive the row badges / pills.
const EMERGENCY_EVENTS = new Set(["emergency_detected"]);
const ESCALATION_EVENTS = new Set(["escalation_created"]);
const ERROR_EVENTS = new Set([
  "outbound_send_failed",
  "outbound_send_failed_permanent",
  "outbound_send_failed_transient",
  "signature_verification_failed",
  "agent_error",
]);

function lastActivity(c: {
  last_user_msg_at: string | null;
  last_bot_msg_at: string | null;
  created_at: string;
}): string {
  const times = [c.last_user_msg_at, c.last_bot_msg_at, c.created_at]
    .filter((t): t is string => Boolean(t))
    .sort();
  return times[times.length - 1] ?? c.created_at;
}

/** Top 200 conversations, most-recent-activity first, with preview + flags. */
export async function listConversations(): Promise<ConversationRow[]> {
  const { data: convs, error: convErr } = await supabaseAdmin
    .from("conversations")
    .select(
      "id, whatsapp_phone, state, service_intent, escalation_status, opt_out, last_user_msg_at, last_bot_msg_at, created_at, updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(LIST_LIMIT);

  if (convErr || !convs || convs.length === 0) return [];

  const ids = convs.map((c) => c.id as string);

  // Last message + count per conversation (desc so the first row seen per
  // conversation is the latest).
  const { data: msgs } = await supabaseAdmin
    .from("messages")
    .select("conversation_id, direction, content, created_at")
    .in("conversation_id", ids)
    .order("created_at", { ascending: false })
    .limit(MESSAGE_SCAN_CAP);

  const lastByConv = new Map<string, { direction: "inbound" | "outbound"; content: string }>();
  const countByConv = new Map<string, number>();
  for (const m of msgs ?? []) {
    const cid = m.conversation_id as string;
    countByConv.set(cid, (countByConv.get(cid) ?? 0) + 1);
    if (!lastByConv.has(cid)) {
      lastByConv.set(cid, {
        direction: m.direction as "inbound" | "outbound",
        content: m.content as string,
      });
    }
  }

  // Audit flags per conversation.
  const { data: audits } = await supabaseAdmin
    .from("audit_log")
    .select("conversation_id, event_type")
    .in("conversation_id", ids);

  const flags = new Map<string, { emergency: boolean; escalation: boolean; error: boolean }>();
  for (const a of audits ?? []) {
    const cid = a.conversation_id as string;
    if (!cid) continue;
    const f = flags.get(cid) ?? { emergency: false, escalation: false, error: false };
    const ev = a.event_type as string;
    if (EMERGENCY_EVENTS.has(ev)) f.emergency = true;
    if (ESCALATION_EVENTS.has(ev)) f.escalation = true;
    if (ERROR_EVENTS.has(ev) || ev.startsWith("outbound_send_failed")) f.error = true;
    flags.set(cid, f);
  }

  // Single request-time clock for all time-relative fields (force-dynamic page).
  const now = Date.now();

  return convs.map((c) => {
    const f = flags.get(c.id as string);
    const activityAt = lastActivity(c);
    return {
      id: c.id as string,
      phone: c.whatsapp_phone as string,
      state: c.state as string,
      serviceIntent: (c.service_intent as string | null) ?? null,
      escalationStatus: c.escalation_status as string,
      optOut: c.opt_out as boolean,
      lastActivityAt: activityAt,
      isActive: isWithinActiveWindow(activityAt, now),
      timeSinceLabel: relativeTime(activityAt, now),
      lastMessage: lastByConv.get(c.id as string) ?? null,
      messageCount: countByConv.get(c.id as string) ?? 0,
      hasEmergency: f?.emergency ?? false,
      hasEscalation: f?.escalation ?? false,
      hasError: f?.error ?? false,
    };
  });
}

/** Full time-sorted thread (messages + non-duplicate audit events). */
export async function getThread(conversationId: string): Promise<ThreadItem[]> {
  const [{ data: msgs }, { data: audits }, { data: media }] = await Promise.all([
    supabaseAdmin
      .from("messages")
      .select(
        "id, direction, content, content_type, claude_model_used, claude_tokens_out, created_at, raw_payload",
      )
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("audit_log")
      .select("id, event_type, event_data, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }),
    // Still-stored ops-media for this thread (purged rows excluded → render falls
    // back to the "expired" placeholder).
    supabaseAdmin
      .from("ops_media")
      .select("id, message_id, media_kind")
      .eq("conversation_id", conversationId)
      .is("deleted_at", null),
  ]);

  const mediaByMessage = new Map<string, { id: string; kind: string }>();
  for (const r of (media ?? []) as Array<{ id: string; message_id: string | null; media_kind: string }>) {
    if (r.message_id) mediaByMessage.set(r.message_id, { id: r.id, kind: r.media_kind });
  }

  const messageItems: MessageItem[] = (msgs ?? []).map((m) => {
    const om = mediaByMessage.get(m.id as string);
    // Surface validated coords for location messages only; parseLocation
    // returns null (→ all four fields null) for any other type or bad payload,
    // so the bubble falls back to the plain "[location]" text.
    const loc =
      m.content_type === "location" ? parseLocation(m.raw_payload) : null;
    return {
      kind: "message",
      id: m.id as string,
      direction: m.direction as "inbound" | "outbound",
      content: m.content as string,
      contentType: m.content_type as string,
      model: (m.claude_model_used as string | null) ?? null,
      tokensOut: (m.claude_tokens_out as number | null) ?? null,
      createdAt: m.created_at as string,
      opsMediaId: om?.id ?? null,
      mediaKind: om?.kind ?? null,
      latitude: loc?.latitude ?? null,
      longitude: loc?.longitude ?? null,
      locationName: loc?.name ?? null,
      locationAddress: loc?.address ?? null,
    };
  });

  const auditItems: AuditItem[] = (audits ?? [])
    .filter((a) => !HIDDEN_AUDIT_TYPES.has(a.event_type as string))
    .map((a) => ({
      kind: "audit",
      id: a.id as string,
      eventType: a.event_type as string,
      eventData: (a.event_data as Record<string, unknown>) ?? {},
      createdAt: a.created_at as string,
    }));

  return [...messageItems, ...auditItems].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

/** Header + stats-strip metadata for one conversation. */
export async function getConversationMeta(
  conversationId: string,
): Promise<ConversationMeta | null> {
  const { data: conv, error } = await supabaseAdmin
    .from("conversations")
    .select("id, whatsapp_phone, state, service_intent, escalation_status, opt_out, created_at")
    .eq("id", conversationId)
    .maybeSingle();
  if (error || !conv) return null;

  const { data: msgs } = await supabaseAdmin
    .from("messages")
    .select("claude_model_used, claude_tokens_out")
    .eq("conversation_id", conversationId);

  let totalTokensOut = 0;
  const models = new Set<string>();
  for (const m of msgs ?? []) {
    totalTokensOut += (m.claude_tokens_out as number | null) ?? 0;
    const model = m.claude_model_used as string | null;
    if (model) models.add(model);
  }

  return {
    id: conv.id as string,
    phone: conv.whatsapp_phone as string,
    state: conv.state as string,
    serviceIntent: (conv.service_intent as string | null) ?? null,
    escalationStatus: conv.escalation_status as string,
    optOut: conv.opt_out as boolean,
    firstSeenAt: conv.created_at as string,
    messageCount: msgs?.length ?? 0,
    totalTokensOut,
    modelsUsed: [...models],
  };
}
