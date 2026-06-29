// Slice 4a C7 — Tool executors for the 4 new Slice 4a tools.
//
// Sidecar module to keep adapter.ts surgically small. The adapter's tool
// dispatch switch (handleInboundMessage) calls into these for the 4 new
// tool names; everything else stays where it lives.
//
// Identity gating: relay_to_patient and confirm_relay reject when
// identity.role !== 'ops_founder' (defense-in-depth — the orchestrator
// only advertises these tools in ops mode, but a misbehaving model could
// theoretically still emit the name. The executor refuses.)

import { getBookingHistory, getFamilyMembers, type BookingHistoryFilter } from "@/lib/agent/dataTools";
import {
  createRelayDraft,
  findLatestUnexpiredRelayDraft,
  markRelayDraftResolved,
} from "@/lib/whatsapp/opsRouter";
import { detectLanguage } from "@/lib/whatsapp/languageDetect";
import { dispatchTextMessage, persistRelayIntoRecipientThread } from "@/lib/whatsapp/db";
import { supabaseAdmin } from "@/lib/supabase-server";
import { log } from "@/lib/whatsapp/log";
import type { Identity } from "@/lib/whatsapp/identity";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "pending assignment",
  PENDING_COLLECTION: "pending lab collection",
  CONFIRMED: "confirmed",
  DISPATCHED: "dispatched",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

// ---------------------------------------------------------------------------
// get_booking_history
// ---------------------------------------------------------------------------

export async function executeGetBookingHistory(
  phone: string,
  input: { filter?: BookingHistoryFilter },
): Promise<string> {
  const bookings = await getBookingHistory(phone, input.filter ?? "all");
  if (bookings.length === 0) {
    return "I don't see any bookings on this number yet. Want me to set one up?";
  }
  const top = bookings.slice(0, 5);
  const lines = top.map((b) => {
    const date = b.created_at.split("T")[0];
    const status = STATUS_LABEL[b.status] ?? b.status.toLowerCase();
    const service = b.service_category ?? "service";
    return `• ${date} — ${service}, ${status}`;
  });
  const more = bookings.length > top.length ? `\n…and ${bookings.length - top.length} older.` : "";
  return `Here's what I see:\n${lines.join("\n")}${more}`;
}

// ---------------------------------------------------------------------------
// get_family_members
// ---------------------------------------------------------------------------

export async function executeGetFamilyMembers(identity: Identity): Promise<string> {
  if (identity.role !== "customer" || !("customerId" in identity) || !identity.customerId) {
    return "I don't see a Sanocare account linked to this number yet — once you book, we can save family members so you don't have to re-enter details.";
  }
  const members = await getFamilyMembers(identity.customerId);
  if (members.length === 0) {
    return "No family members saved on your account yet. We can add up to 8 — just tell me who.";
  }
  const lines = members.map((m) => {
    const rel = m.relation === "other" && m.relation_other ? m.relation_other : m.relation;
    const age = m.age != null ? `, ${m.age}` : "";
    return `• ${m.full_name} (${rel}${age})`;
  });
  return `On your account:\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// relay_to_patient (OPS-ONLY)
// ---------------------------------------------------------------------------

const OPS_GATE_REJECT = "I can only relay messages on behalf of Sanocare ops. This isn't an ops account.";

interface RelayDraftDependencies {
  /** Injectable so tests can avoid hitting a real LLM. In prod the
   *  adapter wires this to a thin generateResponse call with a focused
   *  composer prompt. */
  composeDraftBody: (args: {
    instruction: string;
    targetLanguage: string | null;
  }) => Promise<string>;
}

export async function executeRelayToPatient(
  args: {
    identity: Identity;
    opsConversationId: string;
    input: { target_phone: string; instruction: string };
  },
  deps: RelayDraftDependencies,
): Promise<string> {
  if (args.identity.role !== "ops_founder") {
    return OPS_GATE_REJECT;
  }

  const digitsOnly = args.input.target_phone.replace(/\D/g, "").slice(-12);
  if (digitsOnly.length < 10) {
    return "That doesn't look like a valid phone. Send me +91-prefixed format.";
  }

  // Look up the target patient's stored language (if any conversation exists).
  let targetLanguage: string | null = null;
  try {
    const { data } = await supabaseAdmin
      .from("conversations")
      .select("language")
      .ilike("whatsapp_phone", `%${digitsOnly.slice(-10)}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const raw = (data as { language?: string | null } | null)?.language;
    if (raw === "english" || raw === "hindi" || raw === "hinglish") targetLanguage = raw;
  } catch (err) {
    log.error("relay target language lookup failed", err);
  }

  let draftBody: string;
  try {
    draftBody = await deps.composeDraftBody({
      instruction: args.input.instruction,
      targetLanguage,
    });
  } catch (err) {
    log.error("relay draft compose failed", err);
    return "Couldn't compose the draft — try again, or call the patient directly.";
  }

  const draft = await createRelayDraft({
    opsConversationId: args.opsConversationId,
    targetPhone: args.input.target_phone,
    instruction: args.input.instruction,
    draftBody,
    language: targetLanguage,
  });

  if (!draft) {
    return "Composed the draft but couldn't save it. Try once more.";
  }

  return `Draft to ${args.input.target_phone} (${targetLanguage ?? "lang unknown"}):\n\n${draftBody}\n\nReply YES to send (expires in 15 min), or describe changes.`;
}

// ---------------------------------------------------------------------------
// confirm_relay (OPS-ONLY)
// ---------------------------------------------------------------------------

export async function executeConfirmRelay(args: {
  identity: Identity;
  opsConversationId: string;
  input: { resolution: "YES" | "CANCEL" };
}): Promise<string> {
  if (args.identity.role !== "ops_founder") {
    return OPS_GATE_REJECT;
  }
  const draft = await findLatestUnexpiredRelayDraft(args.opsConversationId);
  if (!draft) {
    return "No pending draft to confirm. Tell me what to relay and I'll draft it.";
  }
  if (args.input.resolution === "CANCEL") {
    await markRelayDraftResolved({
      opsConversationId: args.opsConversationId,
      draftId: draft.draftId,
      resolution: "cancelled",
    });
    return "Cancelled. Patient receives nothing.";
  }
  // YES — send the patient-facing message via the hardened sender.
  const sendResult = await dispatchTextMessage({
    conversationId: draft.opsConversationId, // audit attribution to ops conv
    phone: draft.targetPhone,
    body: draft.draftBody,
    safetyFlags: { ops_relay: true, draft_id: draft.draftId },
  });
  let sentWamid: string | undefined;
  if (sendResult.sent) {
    sentWamid = sendResult.providerMessageId;
  } else {
    return `Patient send blocked or failed. Draft kept; call them directly.`;
  }
  // Persist the relay into the RECIPIENT's thread so it shows in
  // /ops/conversations (the send is attributed to the ops conversation, so
  // without this the recipient thread never reflects the relay). Only on a real
  // send (wamid present); soft-fail inside the helper.
  if (sentWamid) {
    await persistRelayIntoRecipientThread({
      targetPhone: draft.targetPhone,
      body: draft.draftBody,
      providerMessageId: sentWamid,
      draftId: draft.draftId,
    });
  }
  await markRelayDraftResolved({
    opsConversationId: args.opsConversationId,
    draftId: draft.draftId,
    resolution: "confirmed",
    sentWamid,
  });
  return `Sent ✓ to ${draft.targetPhone}.`;
}

// ---------------------------------------------------------------------------
// Conversation language storage (post-receive, pre-Claude)
// ---------------------------------------------------------------------------

/**
 * Persist the per-turn detected language to conversations.language. Only
 * for PATIENT inbound (caller decides). Soft-fail — a missing column or
 * stale schema returns silently; observability comes through log.error.
 */
export async function persistConversationLanguage(
  conversationId: string,
  detectedFor: string,
): Promise<void> {
  if (!detectedFor.trim()) return;
  const detected = detectLanguage(detectedFor);
  try {
    const { error } = await supabaseAdmin
      .from("conversations")
      .update({ language: detected.language })
      .eq("id", conversationId);
    if (error) log.error("persistConversationLanguage update failed", error.message);
  } catch (err) {
    log.error("persistConversationLanguage threw", err);
  }
}
