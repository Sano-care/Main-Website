// Persistence + outbound dispatch for the WhatsApp agent.
//
// Everything that touches the DB or sends an outbound message goes through
// here, so the invariants live in one place:
//   * dispatchTextMessage is the ONLY path to the Cloud API. It re-reads
//     opt_out from the DB immediately before every send and hard-refuses if
//     true (safety rule #4) — no override flag exists.
//   * recordInboundMessage is idempotent on the WhatsApp wamid (handles Meta's
//     webhook retries).
//   * messages / audit_log are append-only.

import { supabaseAdmin } from "@/lib/supabase-server";
import { sendHardenedTemplate, sendHardenedText } from "@/lib/whatsapp/sender";
import { isTemplateName, type TemplateName } from "@/lib/whatsapp/templates";
import { AuditEvent, writeAudit } from "@/lib/whatsapp/safety/audit";
import { log, maskPhone } from "@/lib/whatsapp/log";
import type { NormalizedInbound } from "@/types/whatsapp";

const PG_UNIQUE_VIOLATION = "23505";

export interface ConversationRow {
  id: string;
  whatsapp_phone: string;
  lead_id: string | null;
  opt_out: boolean;
  state: string;
}

/**
 * Find the most recent conversation for a phone, creating the lead and
 * conversation rows if this is a first contact. Returns the conversation and
 * whether it was newly created.
 */
export async function findOrCreateConversation(
  phone: string,
): Promise<{ conversation: ConversationRow; isNew: boolean }> {
  // Ensure a lead exists (unique on whatsapp_phone).
  const { data: lead, error: leadErr } = await supabaseAdmin
    .from("leads")
    .upsert(
      { whatsapp_phone: phone },
      { onConflict: "whatsapp_phone", ignoreDuplicates: false },
    )
    .select("id")
    .single();
  if (leadErr) {
    log.error("lead upsert failed", maskPhone(phone), leadErr.message);
    throw new Error("lead_upsert_failed");
  }

  // Most recent conversation for this phone.
  const { data: existing, error: findErr } = await supabaseAdmin
    .from("conversations")
    .select("id, whatsapp_phone, lead_id, opt_out, state")
    .eq("whatsapp_phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findErr) {
    log.error("conversation lookup failed", maskPhone(phone), findErr.message);
    throw new Error("conversation_lookup_failed");
  }
  if (existing) {
    return { conversation: existing as ConversationRow, isNew: false };
  }

  const { data: created, error: createErr } = await supabaseAdmin
    .from("conversations")
    .insert({ whatsapp_phone: phone, lead_id: lead.id })
    .select("id, whatsapp_phone, lead_id, opt_out, state")
    .single();
  if (createErr) {
    log.error("conversation insert failed", maskPhone(phone), createErr.message);
    throw new Error("conversation_insert_failed");
  }
  return { conversation: created as ConversationRow, isNew: true };
}

/**
 * Insert an inbound message row. Idempotent: a duplicate wamid (Meta retry)
 * is a no-op. Returns whether a row was newly inserted.
 */
export async function recordInboundMessage(args: {
  conversationId: string;
  inbound: NormalizedInbound;
  safetyFlags?: Record<string, unknown>;
}): Promise<{ inserted: boolean }> {
  const { conversationId, inbound, safetyFlags } = args;
  const { error } = await supabaseAdmin.from("messages").insert({
    conversation_id: conversationId,
    direction: "inbound",
    content: inbound.text ?? `[${inbound.type}]`,
    content_type: inbound.type === "text" ? "text" : inbound.type,
    provider_message_id: inbound.providerMessageId,
    raw_payload: inbound.raw,
    safety_flags: safetyFlags ?? {},
  });

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      log.info("duplicate inbound ignored (idempotent)", inbound.providerMessageId);
      return { inserted: false };
    }
    log.error("inbound insert failed", error.message);
    throw new Error("inbound_insert_failed");
  }

  // Touch last_user_msg_at.
  await supabaseAdmin
    .from("conversations")
    .update({
      last_user_msg_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId);

  return { inserted: true };
}

export type DispatchResult =
  | { sent: true; providerMessageId?: string }
  | { sent: false; blocked: true }
  | { sent: false; blocked: false; error: string };

/**
 * The ONE outbound path. Re-reads opt_out from the DB and refuses to send if
 * the user has opted out (safety rule #4), recording an opt_out_send_blocked
 * audit row. On success, appends the outbound message row and touches
 * last_bot_msg_at.
 */
export async function dispatchTextMessage(args: {
  conversationId: string;
  phone: string;
  body: string;
  safetyFlags?: Record<string, unknown>;
}): Promise<DispatchResult> {
  const { conversationId, phone, body, safetyFlags } = args;

  // Fresh opt-out check immediately before sending — never trust a cached flag.
  const { data: convo, error: readErr } = await supabaseAdmin
    .from("conversations")
    .select("opt_out")
    .eq("id", conversationId)
    .single();
  if (readErr) {
    log.error("opt_out precheck read failed", readErr.message);
    return { sent: false, blocked: false, error: "opt_out_precheck_failed" };
  }
  if (convo?.opt_out === true) {
    log.warn("outbound blocked: opt_out", maskPhone(phone));
    await writeAudit({
      conversationId,
      eventType: AuditEvent.OPT_OUT_SEND_BLOCKED,
      eventData: { phone, attempted_body_length: body.length },
    });
    return { sent: false, blocked: true };
  }

  // Slice 2b — delegate the actual send to the hardened sender, which handles
  // idempotency, the 24h session-window check, classify+retry of transient
  // failures, the outbound message-row persist, and the differentiated audit
  // events. dispatchTextMessage keeps ownership only of the opt-out gate above
  // and the DispatchResult contract its callers depend on.
  const result = await sendHardenedText({ conversationId, phone, body, safetyFlags });

  if (result.ok) {
    return { sent: true, providerMessageId: result.providerMessageId };
  }
  if (result.reason === "session_expired") {
    // Caller can fall back to a template send (sendHardenedTemplate).
    log.warn("outbound refused: session window closed", maskPhone(phone));
    return { sent: false, blocked: false, error: "session_expired" };
  }
  return { sent: false, blocked: false, error: result.error.classification };
}

/**
 * Slice 3 (T66) — template-sender mirror of dispatchTextMessage.
 *
 * Same contract: re-reads opt_out IMMEDIATELY before sending (never trusts a
 * cached value), records OPT_OUT_SEND_BLOCKED on block, otherwise delegates
 * to Slice 2b's `sendHardenedTemplate` (idempotency + retry + audit + persist).
 *
 * Templates are named in `src/lib/whatsapp/templates.ts` and resolved via
 * `renderTemplate` inside `sendHardenedTemplate` — the registry enforces that
 * required {{1}}..{{n}} vars are present and consistently ordered.
 *
 * Returns the same DispatchResult shape as dispatchTextMessage so the Slice 3
 * dispatcher's call sites can treat both paths uniformly.
 */
export async function dispatchTemplateMessage(args: {
  conversationId: string;
  phone: string;
  templateName: string;
  vars: Record<string, string>;
  safetyFlags?: Record<string, unknown>;
}): Promise<DispatchResult> {
  const { conversationId, phone, templateName, vars, safetyFlags } = args;

  if (!isTemplateName(templateName)) {
    // A template name the registry doesn't know — refuse rather than try a
    // raw Cloud API call. This is a programming error, not a runtime one.
    log.error("dispatchTemplateMessage: unknown template", templateName);
    return { sent: false, blocked: false, error: "unknown_template" };
  }
  const knownTemplate: TemplateName = templateName;

  // Fresh opt-out check — mirror of dispatchTextMessage. Cached flags are
  // never trusted here; the read happens immediately before the send.
  const { data: convo, error: readErr } = await supabaseAdmin
    .from("conversations")
    .select("opt_out")
    .eq("id", conversationId)
    .single();
  if (readErr) {
    log.error("opt_out precheck read failed (template)", readErr.message);
    return { sent: false, blocked: false, error: "opt_out_precheck_failed" };
  }
  if (convo?.opt_out === true) {
    log.warn("template outbound blocked: opt_out", maskPhone(phone));
    await writeAudit({
      conversationId,
      eventType: AuditEvent.OPT_OUT_SEND_BLOCKED,
      eventData: { phone, template_name: knownTemplate },
    });
    return { sent: false, blocked: true };
  }

  const result = await sendHardenedTemplate({
    conversationId,
    phone,
    templateName: knownTemplate,
    vars,
    safetyFlags,
  });

  if (result.ok) {
    return { sent: true, providerMessageId: result.providerMessageId };
  }
  if (result.reason === "session_expired") {
    // Template sends are themselves the outside-window fallback, so this
    // shouldn't happen — but if it does (e.g. the hardened sender's window
    // gate widens to template later), surface a useful classification.
    log.warn("template send refused: session window check", maskPhone(phone));
    return { sent: false, blocked: false, error: "session_expired" };
  }
  return { sent: false, blocked: false, error: result.error.classification };
}

/**
 * Persist the permanent, global opt-out. Flips conversations.opt_out and state,
 * and the lead's consent_status. Call this AFTER the confirmation has been sent
 * (so the confirmation itself isn't blocked) — see orchestrator.
 */
export async function setOptOut(args: {
  conversationId: string;
  leadId: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("conversations")
    .update({ opt_out: true, state: "opted_out", updated_at: now })
    .eq("id", args.conversationId);
  if (args.leadId) {
    await supabaseAdmin
      .from("leads")
      .update({ consent_status: "opted_out", updated_at: now })
      .eq("id", args.leadId);
  }
}

/**
 * Append an escalation row and reflect it on the conversation. Writes an
 * escalation_created audit row. Returns the new escalation id (or null on
 * failure — failure is logged, never thrown, so the user-facing flow survives).
 */
export async function createEscalation(args: {
  conversationId: string;
  escalationType: string;
  priority: "p1" | "p2" | "p3";
  slackMessageId?: string | null;
  newState?: string;
}): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("escalations")
    .insert({
      conversation_id: args.conversationId,
      escalation_type: args.escalationType,
      priority: args.priority,
      slack_message_id: args.slackMessageId ?? null,
    })
    .select("id")
    .single();

  if (error) {
    log.error("escalation insert failed", error.message);
    return null;
  }

  await supabaseAdmin
    .from("conversations")
    .update({
      escalation_status: "requested",
      state: args.newState ?? "escalated",
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.conversationId);

  await writeAudit({
    conversationId: args.conversationId,
    eventType: AuditEvent.ESCALATION_CREATED,
    eventData: { escalation_id: data.id, type: args.escalationType, priority: args.priority },
  });

  return data.id;
}

// ---------------------------------------------------------------------------
// Week-2 agent helpers.
// ---------------------------------------------------------------------------

/**
 * Load the last `limit` messages for a conversation as orchestrator history
 * (oldest → newest). inbound → "user", outbound → "assistant".
 */
export async function loadHistory(
  conversationId: string,
  limit: number,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("direction, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) {
    log.error("loadHistory failed", error?.message);
    return [];
  }
  return data
    .reverse()
    .map((m) => ({
      role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
      content: m.content as string,
    }));
}

/** Count inbound (user) messages — used for model-routing turn count. */
export async function countInboundMessages(conversationId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound");
  if (error) {
    log.error("countInboundMessages failed", error.message);
    return 0;
  }
  return count ?? 0;
}

/** Update lead profile fields captured during qualification. Best-effort. */
export async function updateLeadFields(
  leadId: string | null,
  fields: Record<string, unknown>,
): Promise<void> {
  if (!leadId) return;
  const { error } = await supabaseAdmin
    .from("leads")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", leadId);
  if (error) log.error("updateLeadFields failed", error.message);
}

/**
 * Store the outbound ops-alert template's wamid on the escalation, so an inbound
 * "Mark as Attended" button reply (whose context.id == this wamid) maps back to
 * the right escalation. (slack_message_id is repurposed for the WA template wamid.)
 */
export async function setEscalationProviderMessageId(
  escalationId: string,
  wamid: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("escalations")
    .update({ slack_message_id: wamid })
    .eq("id", escalationId);
  if (error) log.error("setEscalationProviderMessageId failed", error.message);
}

/**
 * Mark the escalation whose ops-alert wamid == `wamid` as attended. Returns true
 * if a still-open escalation matched. Idempotent (won't re-mark an acknowledged one).
 */
export async function markEscalationAttended(
  wamid: string,
  byIdentifier: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("escalations")
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: byIdentifier,
    })
    .eq("slack_message_id", wamid)
    .is("acknowledged_at", null)
    .select("id, conversation_id")
    .maybeSingle();
  if (error) {
    log.error("markEscalationAttended failed", error.message);
    return null;
  }
  if (!data) return null;
  await supabaseAdmin
    .from("conversations")
    .update({ escalation_status: "complete", updated_at: new Date().toISOString() })
    .eq("id", data.conversation_id);
  return data.id;
}
