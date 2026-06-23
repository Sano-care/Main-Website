// Channel-agnostic conversation orchestrator — the Aarogya "brain".
//
// It takes (conversationId, channel, userText, history, turnCount) and returns
// (replyText, toolCalls, usage). It knows NOTHING about WhatsApp: adapters
// translate each channel to/from these types, so the Week-4 website widget and
// Week-5 mobile app reuse this unchanged.
//
// The deterministic pre-checks (emergency regex, opt-out) run UPSTREAM in the
// adapter, before this is called — this is the LLM layer (second line on
// safety). The adapter is also responsible for executing the returned toolCalls
// (escalate_to_ops → template send + escalation row; set_opt_out → opt-out flag)
// and persisting messages/audit rows.

import { generateResponse } from "@/lib/agent/client";
import {
  getSystemPrompt,
  getSystemPromptForTurn,
  selectModel,
  HISTORY_LIMIT,
  MAX_OUTPUT_TOKENS,
} from "@/lib/agent/config";
import { AAROGYA_CAREHUB_TOOLS, AAROGYA_MEDIC_TOOLS, AAROGYA_OPS_TOOLS, AAROGYA_TOOLS } from "@/lib/agent/tools";
import type { AgentTurnInput, AgentTurnResult } from "@/lib/agent/types";

/**
 * Run one agent turn. Pure with respect to side effects — it calls Claude and
 * returns a result; persistence + tool execution happen in the adapter.
 */
export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  // Slice 4a — when identity + context are threaded by the adapter, use the
  // hybrid composer (mirror rule + short-message rule + per-identity
  // addendums + per-turn context block). Otherwise stay on the legacy
  // zero-arg path for non-Aarogya channels / call sites that don't supply.
  const system =
    input.identity && input.tier1ContextBlock
      ? getSystemPromptForTurn(input.identity, input.tier1ContextBlock, {
          pendingDraftTargetPhone: input.pendingRelayDraftTargetPhone ?? null,
        })
      : getSystemPrompt();
  const model = selectModel(input);

  // ops_founder gets the relay tools merged in (Slice 4a). CareHub members
  // get surface_carehub_benefits merged in (Slice 5). Everyone else sees only
  // AAROGYA_TOOLS. Withholding the schema is defense-in-depth on top of the
  // executor-level identity gates.
  const tools =
    input.identity?.role === "ops_founder"
      ? [...AAROGYA_TOOLS, ...AAROGYA_OPS_TOOLS]
      : input.identity?.role === "medic"
        ? // Medic mode REPLACES the patient tool set — a medic never sees the
          // patient/booking tools, only the three medic tools.
          AAROGYA_MEDIC_TOOLS
        : input.identity?.role === "customer" && input.identity.subRole === "carehub"
          ? [...AAROGYA_TOOLS, ...AAROGYA_CAREHUB_TOOLS]
          : AAROGYA_TOOLS;

  // Build the message list: capped history (oldest → newest) + the new user turn.
  const trimmed = input.history.slice(-HISTORY_LIMIT);
  const messages = [
    ...trimmed.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: input.userText },
  ];

  const res = await generateResponse({
    model,
    system,
    messages,
    tools,
    maxTokens: MAX_OUTPUT_TOKENS,
  });

  return {
    replyText: res.text.trim(),
    toolCalls: res.toolUses.map((t) => ({ id: t.id, name: t.name, input: t.input })),
    modelUsed: res.model,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    stopReason: res.stopReason,
  };
}
